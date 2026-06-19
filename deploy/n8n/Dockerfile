FROM n8nio/n8n:latest

USER root

ENV N8N_USER_FOLDER=/home/node/.n8n

RUN mkdir -p /home/node/.n8n \
  && chown -R node:node /home/node/.n8n

COPY deploy/n8n/start.sh /usr/local/bin/agent-ai-n8n-start
RUN chmod +x /usr/local/bin/agent-ai-n8n-start

ENTRYPOINT ["/usr/local/bin/agent-ai-n8n-start"]
