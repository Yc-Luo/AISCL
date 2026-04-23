# Multi-stage build for optimized Node.js application
FROM node:20-alpine as base

# Set environment variables
ENV NODE_ENV=production

# Install build dependencies
RUN apk add --no-cache \
    git \
    && rm -rf /var/cache/apk/*

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S AISCL -u 1001

# Set work directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Dependencies stage
FROM base as deps

# Install dependencies
RUN npm install --legacy-peer-deps && npm cache clean --force

# Build stage
FROM base as builder

# Copy package files and install all dependencies
COPY package*.json ./
RUN npm install --legacy-peer-deps --include=dev && npm cache clean --force

# Copy source code
COPY . .

# Build application
RUN npm run build

# Production stage
FROM nginx:alpine as production

# Copy custom nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Copy built application from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Create non-root user for nginx
RUN addgroup -g 1001 -S nodejs && \
    adduser -S AISCL -u 1001 && \
    chown -R AISCL:nodejs /usr/share/nginx/html && \
    chown -R AISCL:nodejs /var/cache/nginx && \
    chown -R AISCL:nodejs /var/log/nginx && \
    chown -R AISCL:nodejs /etc/nginx/conf.d

# Switch to non-root user
USER AISCL

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://127.0.0.1/health || exit 1

# Expose port
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]

