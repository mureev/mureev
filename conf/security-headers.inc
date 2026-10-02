# The response headers this site adds, in one place. default.conf includes
# this file twice — at server level and inside the GET `if` — for the reason
# given there. All `always`, so error responses carry them too.
#
# Each page carries its own Content-Security-Policy in a <meta>; this file
# says what a <meta> can't. Left out on purpose: HSTS (the TLS proxy in
# front owns it), Permissions-Policy and the Cross-Origin-* family (no
# third-party code runs here — the CSP sees to that — so they'd fence
# nothing), Referrer-Policy (the browser's default is the right one).

# Pages can't be framed: the one CSP directive a <meta> can't carry. Pages
# only — $frame_ancestors is empty for everything else, and an empty
# add_header adds nothing.
add_header Content-Security-Policy $frame_ancestors always;

# A file is the type it's served as: no sniffing a .txt into a page.
add_header X-Content-Type-Options "nosniff" always;

# GNU Terry Pratchett — https://xclacksoverhead.org
add_header X-Clacks-Overhead "GNU Terry Pratchett" always;
