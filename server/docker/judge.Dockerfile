FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential \
      python3 \
      openjdk-17-jdk-headless \
      coreutils \
 && ln -sf /usr/bin/python3 /usr/local/bin/python \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /box
