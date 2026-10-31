// Vendor validity is a dated assertion, independent of persona fit or buyer authority.
export function validContactVerification(value, asOf = Date.now()) {
  const date=value?.verificationDate;
  const parsed=typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)?Date.parse(date):NaN;
  const calendarValid=Number.isFinite(parsed)&&new Date(parsed).toISOString().slice(0,10)===date;
  return !!value&&value.status==='valid'&&value.regexp===true&&value.mxFound===true&&value.smtpCheck===true&&value.acceptAll===false&&value.blocked===false&&value.disposable===false&&value.webmail===false&&calendarValid&&asOf>=parsed&&asOf-parsed<=30*86400000;
}
