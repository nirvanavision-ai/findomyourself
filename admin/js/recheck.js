/*
 * FINDOM YOURSELF · Control Room: loaded only when the sign-in form was shown to a visit that came
 * from another site, like the "+ Findom" bookmark clicked on a shop's page. Browsers hold the
 * SameSite=Strict sign-in cookie back on that first request, so the form shows even when she's
 * signed in. One reload from this page sends the cookie (and keeps the #add=… in the address).
 * At most once a minute per tab, so when she really is signed out the form simply stays.
 */
(function () {
  try {
    var last = Number(sessionStorage.getItem('findom:recheck') || 0);
    if (Date.now() - last < 60000) return;
    sessionStorage.setItem('findom:recheck', String(Date.now()));
    location.reload();
  } catch (e) {
    // no storage: no retry, the sign-in form is right there
  }
}());
