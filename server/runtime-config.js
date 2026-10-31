const loopback = host => ['127.0.0.1','localhost','::1','[::1]'].includes(host);

export function runtimeConfig(env = process.env) {
  const host=env.HOST || '127.0.0.1', port=Number(env.PORT || 3001);
  if(!Number.isInteger(port)||port<0||port>65535)throw Error('PORT must be an integer from 0 through 65535.');
  if(!loopback(host)) {
    if(!env.PROJECT_ACCESS_TOKEN)throw Error('PROJECT_ACCESS_TOKEN is required when listening beyond loopback.');
    if(env.PROJECT_ACCESS_TOKEN.length<32 || env.PROJECT_ACCESS_TOKEN!==env.PROJECT_ACCESS_TOKEN.trim())throw Error('Use a project access token with at least 32 characters and no surrounding whitespace.');
    if(!env.PUBLIC_ORIGIN)throw Error('PUBLIC_ORIGIN is required when listening beyond loopback.');
  }
  let publicOrigin;
  if(env.PUBLIC_ORIGIN) {
    let url;
    try {url=new URL(env.PUBLIC_ORIGIN);}catch{throw Error('PUBLIC_ORIGIN must be one HTTP(S) browser origin.');}
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('PUBLIC_ORIGIN must be one HTTP(S) browser origin without credentials, path, query or fragment.');
    if(url.protocol!=='https:'&&!loopback(url.hostname))throw Error('PUBLIC_ORIGIN must use HTTPS beyond loopback.');
    publicOrigin=url.origin;
  }
  return {host,port,publicOrigin,secureCookies:!!publicOrigin?.startsWith('https://')};
}
