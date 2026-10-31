// Browser backups may seed only an untouched server workspace. Existing server work is authoritative.
export function canImportLegacyProfile(server, hadSavedProfile) {
  return !!hadSavedProfile && !server.profileImported && !server.approved && !(server.leads || []).length && !(server.drafts || []).length && !(server.activity || []).length;
}
