#!/usr/bin/env python3
"""Exercise the shipped Linux image, or the same HTTP/storage probe locally.

Creates only disposable data. No project credentials, live providers or external
messages are used. --native validates the probe without claiming a Docker run.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
PROBE = (ROOT / "scripts/deployment-probe.mjs").read_text()
OFF = {name: "false" for name in ["PROJECT_AI_ENABLED", "PROJECT_HUNTER_ENABLED", "PROJECT_TAVILY_ENABLED", "PROJECT_FLEXPRICE_ENABLED", "PROJECT_SENDGRID_ENABLED", "PROJECT_BAND_ENABLED"]}


def directory_manifest(directory):
    """Fingerprint all regular files, hidden entries and empty directories."""
    result = {}
    for entry in sorted(Path(directory).rglob('*')):
        if entry.is_symlink():
            raise RuntimeError('Smoke backup refuses symlinks.')
        key = str(entry.relative_to(directory))
        if entry.is_dir():
            result[key] = {"type": "directory", "mode": entry.stat().st_mode & 0o777}
        elif entry.is_file():
            digest = hashlib.sha256()
            with entry.open('rb') as data:
                for block in iter(lambda: data.read(1024 * 1024), b''):
                    digest.update(block)
            result[key] = {"type": "file", "mode": entry.stat().st_mode & 0o777, "bytes": entry.stat().st_size, "sha256": digest.hexdigest()}
        else:
            raise RuntimeError('Smoke backup requires regular files/directories.')
    assert 'workspace.sqlite' in result and 'knowledge.kuzu' in result
    return result


def copy_offline_fixture(source, target):
    """Caller has already stopped the isolated owner; never copies live app data."""
    expected = directory_manifest(source)
    shutil.copytree(source, target)
    assert directory_manifest(target) == expected, 'Backup/restore content or permissions changed.'
    assert directory_manifest(source) == expected, 'The stopped source must remain untouched.'
    return expected


# Passed on stdin to a disposable container; not shipped in the runtime image.
COPY_VOLUME = r"""
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
function manifest(root){
 const records=[];
 function walk(relative=''){
  for(const name of fs.readdirSync(path.join(root,relative)).sort()){
   const key=path.join(relative,name),file=path.join(root,key),stat=fs.lstatSync(file);
   assert.ok(!stat.isSymbolicLink(),'Backup fixture must not contain symlinks.');
   if(stat.isDirectory()){records.push({path:key,type:'directory',mode:stat.mode&0o777});walk(key);}
   else{assert.ok(stat.isFile());records.push({path:key,type:'file',mode:stat.mode&0o777,bytes:stat.size,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')});}
  }
 }
 walk();assert.ok(records.some(r=>r.path==='workspace.sqlite'));assert.ok(records.some(r=>r.path==='knowledge.kuzu'));return records;
}
assert.notEqual(process.getuid(),0);assert.deepEqual(fs.readdirSync('/data'),[],'Restore only into an empty separate volume.');
const before=manifest('/source');fs.cpSync('/source','/data',{recursive:true,errorOnExist:true,force:false,preserveTimestamps:true});
assert.deepEqual(manifest('/data'),before);assert.deepEqual(manifest('/source'),before);
console.log('Offline separate-volume copy verified: '+before.length+' entries; complete file hashes and permissions match.');
"""


def run(args, *, env=None, source=None, allow_failure=False):
    result = subprocess.run(args, cwd=ROOT, env=env, input=source, text=True, capture_output=True)
    if result.returncode and not allow_failure:
        # Never include argv/environment or the generated token in exceptions.
        print(result.stdout[-10000:], end="")
        print(result.stderr[-10000:], end="")
        raise RuntimeError("Deployment command failed: " + args[0])
    return result


def native():
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Node.js 24+ is required.")
    with tempfile.TemporaryDirectory(prefix="gtm-deployment-smoke-") as temporary:
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        origin = f"http://127.0.0.1:{port}"
        env = {"PATH": os.environ.get("PATH", ""), **OFF, "HOST": "127.0.0.1", "PORT": str(port), "PUBLIC_ORIGIN": origin, "DATA_DIR": temporary + "/data", "PROJECT_ACCESS_TOKEN": secrets.token_hex(32), "GTM_DEPLOYMENT_SMOKE": "1", "GTM_SMOKE_URL": origin}
        missing = {**env, "HOST": "0.0.0.0"}
        missing.pop("PROJECT_ACCESS_TOKEN")
        denied = run([node, "server/index.js"], env=missing, allow_failure=True)
        assert denied.returncode != 0 and "PROJECT_ACCESS_TOKEN is required" in denied.stderr

        def probe(phase, data_dir=None, capture=False):
            result = run([node, "--input-type=module"], env={**env, "DATA_DIR": data_dir or env['DATA_DIR'], "GTM_SMOKE_PHASE": phase, "GTM_SMOKE_CAPTURE": '1' if capture else '0'}, source=PROBE)
            print(result.stdout, end="", flush=True)

        def server_round(phase, data_dir=None):
            with open(temporary + "/server.log", "w+") as logs:
                process = subprocess.Popen([node, "server/index.js"], cwd=ROOT, env={**env, "DATA_DIR": data_dir or env['DATA_DIR']}, stdout=logs, stderr=logs)
                try:
                    probe(phase, data_dir)
                except Exception:
                    logs.seek(0)
                    print(logs.read()[-10000:])
                    raise
                finally:
                    if process.poll() is None:
                        process.terminate()
                    try:
                        process.wait(timeout=30)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()
                        raise RuntimeError("Server failed to shut down within 30 seconds.")
                assert process.returncode == 0, "Server shutdown must finish successfully."

        probe("seed")
        server_round("exercise")
        probe("storage", capture=True)
        server_round("verify")
        backup, restored = temporary + '/backup', temporary + '/restored'
        expected = copy_offline_fixture(env['DATA_DIR'], backup)
        copy_offline_fixture(backup, restored)
        probe('storage', restored)
        server_round('verify', restored)
        assert directory_manifest(env['DATA_DIR']) == expected
        assert directory_manifest(backup) == expected
        print('Separate offline backup/restore retained full file hashes, native graph and exact campaign records; source and backup unchanged.', flush=True)
    print("Native process and isolated backup restoration passed. This is not Docker/Linux verification.", flush=True)


def container():
    if not shutil.which("docker"):
        raise RuntimeError("Docker is required; use --native only to check the local probe.")
    unique = "gtm-smoke-" + uuid.uuid4().hex[:12]
    image, volume = unique + ":test", unique + "-data"
    backup_volume, restored_volume = unique + '-backup', unique + '-restored'
    env = {**os.environ, "PROJECT_ACCESS_TOKEN": secrets.token_hex(32)}
    run(["docker", "info"], env=env)
    print("Building the actual Linux runtime image...", flush=True)
    run(["docker", "build", "--tag", image, "."], env=env)
    info = json.loads(run(["docker", "image", "inspect", image], env=env).stdout)[0]
    assert info["Config"]["User"] == "node"
    assert info["Config"].get("Healthcheck")
    started = False
    try:
        denied = run(["docker", "run", "--rm", "--network", "none", image], env=env, allow_failure=True)
        assert denied.returncode != 0 and "PROJECT_ACCESS_TOKEN is required" in denied.stderr
        run(["docker", "volume", "create", volume], env=env)
        def probe(phase, running=False, data_volume=None, capture=False):
            if running:
                args = ["docker", "exec", "--interactive", "--env", "GTM_DEPLOYMENT_SMOKE=1", "--env", f"GTM_SMOKE_PHASE={phase}", unique, "node", "--input-type=module"]
            else:
                selected_mount = ['--mount',f"type=volume,source={data_volume or volume},target=/data"]
                args = ["docker", "run", "--rm", "--interactive", "--network", "none", *selected_mount, "--env", "GTM_DEPLOYMENT_SMOKE=1", "--env", f"GTM_SMOKE_PHASE={phase}", '--env',f"GTM_SMOKE_CAPTURE={'1' if capture else '0'}", image, "node", "--input-type=module"]
            result = run(args, env=env, source=PROBE)
            print(result.stdout, end="", flush=True)

        def start(data_volume=None):
            # No published port or outbound network. Only docker exec can reach
            # this isolated CI container, using its own loopback HTTP server.
            selected_mount = ['--mount',f"type=volume,source={data_volume or volume},target=/data"]
            args = ["docker", "run", "--detach", "--name", unique, "--network", "none", *selected_mount, "--env", "PROJECT_ACCESS_TOKEN", "--env", "PUBLIC_ORIGIN=http://127.0.0.1:3001"]
            for key, value in OFF.items():
                args.extend(["--env", f"{key}={value}"])
            args.append(image)
            run(args, env=env)

        probe("seed")
        start()
        started = True
        probe("exercise", running=True)
        for _ in range(25):
            status = json.loads(run(["docker", "inspect", unique], env=env).stdout)[0]["State"]
            if status.get("Health", {}).get("Status") == "healthy":
                break
            assert status["Running"], "Container exited before readiness."
            time.sleep(2)
        else:
            raise RuntimeError("Docker healthcheck did not become healthy.")
        # Confirm the explicit COPY list did not package runtime data/secrets/tests.
        check = "const fs=require('node:fs');for(const p of ['.env','.env.deploy','.data','.git','tests','scripts/deployment-probe.mjs'])if(fs.existsSync(p))process.exit(1);if(process.getuid()===0)process.exit(1)"
        run(["docker", "exec", unique, "node", "-e", check], env=env)
        run(["docker", "stop", "--time", "90", unique], env=env)
        state = json.loads(run(["docker", "inspect", unique], env=env).stdout)[0]["State"]
        assert state["ExitCode"] == 0 and not state["OOMKilled"]
        run(["docker", "rm", unique], env=env)
        started = False
        probe("storage", capture=True)
        start()
        started = True
        probe("verify", running=True)
        run(["docker", "stop", "--time", "90", unique], env=env)
        state = json.loads(run(["docker", "inspect", unique], env=env).stdout)[0]["State"]
        assert state["ExitCode"] == 0 and not state["OOMKilled"]
        run(["docker", "rm", unique], env=env)
        started = False

        def copy_volume(source, target):
            run(['docker','volume','create',target],env=env)
            result = run(['docker','run','--rm','--interactive','--network','none','--mount',f'type=volume,source={source},target=/source,readonly','--mount',f'type=volume,source={target},target=/data',image,'node'],env=env,source=COPY_VOLUME)
            print(result.stdout,end='',flush=True)

        copy_volume(volume, backup_volume)
        copy_volume(backup_volume, restored_volume)
        probe('storage', data_volume=restored_volume)
        start(restored_volume)
        started = True
        probe('verify', running=True)
        run(["docker", "stop", "--time", "90", unique], env=env)
        state = json.loads(run(["docker", "inspect", unique], env=env).stdout)[0]["State"]
        assert state["ExitCode"] == 0 and not state["OOMKilled"]
        run(["docker", "rm", unique], env=env)
        started = False
        print("Linux Docker startup, health, HTTP workflow, native persistence, container recreation and separate-volume backup restoration passed.", flush=True)
    except Exception:
        if started:
            print(run(["docker", "logs", "--tail", "60", unique], env=env, allow_failure=True).stdout)
        raise
    finally:
        run(["docker", "rm", "--force", unique], env=env, allow_failure=True)
        run(["docker", "volume", "rm", volume], env=env, allow_failure=True)
        run(["docker", "volume", "rm", backup_volume], env=env, allow_failure=True)
        run(["docker", "volume", "rm", restored_volume], env=env, allow_failure=True)
        run(["docker", "image", "rm", image], env=env, allow_failure=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--native", action="store_true", help="Run the shared probe locally; does not validate Docker.")
    arguments = parser.parse_args()
    try:
        native() if arguments.native else container()
    except Exception as error:
        print(str(error), flush=True)
        raise SystemExit(1)
