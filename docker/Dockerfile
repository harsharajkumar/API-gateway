FROM node:18-alpine

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create app user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./

# Install production dependencies. Fall back to npm install when the repo
# does not include a lockfile, which is common for classroom/demo projects.
RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev; \
    else \
      npm install --omit=dev; \
    fi && npm cache clean --force

# Copy source code
COPY --chown=nodejs:nodejs . .

# Ensure runtime directories exist
RUN mkdir -p /app/logs && chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

ENV NODE_ENV=production
ENV REDIS_OPTIONAL=true
ENV USER_SERVICE_1_URL=http://localhost:3001
ENV USER_SERVICE_2_URL=http://localhost:3002
ENV USER_SERVICE_3_URL=http://localhost:3003
ENV ORDER_SERVICE_1_URL=http://localhost:4001
ENV ORDER_SERVICE_2_URL=http://localhost:4002
ENV AUTH_SERVICE_1_URL=http://localhost:5001
ENV AUTH_SERVICE_2_URL=http://localhost:5002

# Expose ports
EXPOSE 8080 9090

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 8080) + '/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); }).on('error', () => process.exit(1))"

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start gateway + all mock backend services
CMD ["npm", "start"]
