ARG BUILD_FROM
FROM ${BUILD_FROM}

RUN apk add --no-cache python3 ca-certificates

COPY app /opt/zeitwerk
COPY rootfs /

RUN chmod a+x /etc/services.d/zeitwerk/run
