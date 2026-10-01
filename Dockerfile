# mureev.com — static files in stock nginx. The whole build is two COPYs
# and one chmod; anything more would be a dependency, and we don't do those.

# Pinned minor: builds shouldn't change because Tuesday happened.
# (-slim skips the njs/geoip modules a static site will never load.)
FROM nginx:1.30-alpine-slim

LABEL org.opencontainers.image.title="mureev.com" \
      org.opencontainers.image.description="Personal site of Constantine Mureev — a terminal, hand-rolled" \
      org.opencontainers.image.source="https://github.com/mureev/mureev" \
      org.opencontainers.image.authors="constantine@mureev.com"

# conf first: it changes rarely, content changes often — this order keeps
# the conf layer cached across content edits. COPY overwrites the stock
# default.conf in place.
COPY --chmod=644 conf/default.conf /etc/nginx/conf.d/default.conf
COPY content /usr/share/nginx/html

# Normalize modes. COPY keeps the build context's permission bits, and a
# file written 0600 (some sync tools do exactly that) is unreadable to
# nginx's unprivileged workers: every path 403s — it happened, Aug 2026.
# `a+rX` = readable by all, executable only where it's a directory. This
# layer is load-bearing, and CI builds from a 0600 checkout to prove it.
RUN chmod -R a+rX /usr/share/nginx/html

EXPOSE 80

# busybox wget ships with alpine (curl doesn't): is nginx actually serving?
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
    CMD wget -q --spider http://127.0.0.1/ || exit 1
