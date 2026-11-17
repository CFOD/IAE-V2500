// Cloudflare Pages Function, run in front of every request to the site.
// The site is for the owner's testing and sits behind Cloudflare Access on iae.cfod.co.uk. Access guards
// that hostname only, so the project's own *.pages.dev address (and preview addresses) would be a way
// round it: send those to the protected domain instead.
const HOME = 'iae.cfod.co.uk';
export const onRequest = async ({ request, next }) => {
  const url = new URL(request.url);
  if (url.hostname.endsWith('.pages.dev')) { url.hostname = HOME; url.protocol = 'https:'; url.port = ''; return Response.redirect(url.toString(), 302); }
  return next();
};
