FROM debian:bullseye-slim

WORKDIR /app

# Switch to archive mirrors (bullseye security packages moved)
RUN sed -i 's|deb.debian.org/debian-security|archive.debian.org/debian-security|g' /etc/apt/sources.list && \
    sed -i '/bullseye-updates/d' /etc/apt/sources.list

# Install dependencies
RUN apt-get update && apt-get install -y \
    curl \
    postgresql-client \
    bash \
    && rm -rf /var/lib/apt/lists/*

COPY wait-for-it.sh /usr/local/bin/wait-for-it
COPY init-fixtures.sql init-fixtures-booking.sql regress.sh ./
RUN chmod +x /usr/local/bin/wait-for-it regress.sh

ENTRYPOINT ["./regress.sh"]
