// Cloudflare Pages Function, run in front of every request to the site.
// The site is for the owner's testing and sits behind Cloudflare Access on iae.cfod.co.uk.
//  - Access guards that hostname only, so the project's own *.pages.dev address (and preview addresses)
//    would be a way round it: those are sent to the protected domain instead.
//  - The sound recordings (the owner's copy of a commercial pack) are only served to requests that came
//    through Access: they carry its Cf-Access-Jwt-Assertion header or CF_Authorization cookie. Without
//    Access in front, the site still works with the synthesised sound and the pack is not exposed.
const HOME = 'iae.cfod.co.uk';
export const onRequest = async ({ request, next }) => {
  const url = new URL(request.url);
  if (url.hostname.endsWith('.pages.dev')) { url.hostname = HOME; url.protocol = 'https:'; url.port = ''; return Response.redirect(url.toString(), 302); }
  if (url.pathname.startsWith('/sounds/')) {
    const viaAccess = request.headers.get('cf-access-jwt-assertion') || /(^|;\s*)CF_Authorization=/.test(request.headers.get('cookie') || '');
    if (!viaAccess) return new Response('The recordings are only served behind Cloudflare Access.\n', { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  }
  return next();
};
