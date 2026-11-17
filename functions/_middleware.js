// Cloudflare Pages Function, run in front of every request to the site (the owner's test site).
// Sends the project's *.pages.dev addresses (production and previews) to the one real address.
const HOME = 'iae.cfod.co.uk';
export const onRequest = async ({ request, next }) => {
  const url = new URL(request.url);
  if (url.hostname.endsWith('.pages.dev')) { url.hostname = HOME; url.protocol = 'https:'; url.port = ''; return Response.redirect(url.toString(), 302); }
  return next();
};
