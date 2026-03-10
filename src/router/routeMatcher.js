/**
 * Route Matcher
 * Matches incoming requests to configured routes
 */

const logger = require('../utils/logger');

class RouteMatcher {
  constructor(routes) {
    this.routes = routes || [];
  }

  /**
   * Find matching route for the given path and method
   * @param {string} path - Request path (e.g., /api/users/123)
   * @param {string} method - HTTP method (GET, POST, etc.)
   * @returns {object|null} - Matched route or null
   */
  findRoute(path, method) {
    logger.debug('Matching route', { path, method });

    // Try to find exact match first
    for (const route of this.routes) {
      if (this.matchesPath(path, route.path) && this.matchesMethod(method, route.methods)) {
        logger.debug('Route matched', {
          routeId: route.id,
          routePath: route.path,
          backend: route.backend
        });
        return route;
      }
    }

    logger.warn('No route matched', { path, method });
    return null;
  }

  /**
   * Check if request path matches route path pattern
   * @param {string} requestPath - Actual request path
   * @param {string} routePath - Route path pattern
   * @returns {boolean}
   */
  matchesPath(requestPath, routePath) {
    // Remove trailing slashes for comparison
    const normalizedRequest = requestPath.replace(/\/+$/, '') || '/';
    const normalizedRoute = routePath.replace(/\/+$/, '') || '/';

    // Exact match
    if (normalizedRequest === normalizedRoute) {
      return true;
    }

    // Prefix match (route path is a prefix of request path)
    // Example: route /api/users matches request /api/users/123
    if (normalizedRequest.startsWith(normalizedRoute + '/')) {
      return true;
    }

    // Wildcard match (if route ends with /*)
    if (normalizedRoute.endsWith('/*')) {
      const prefix = normalizedRoute.slice(0, -2); // Remove /*
      return normalizedRequest.startsWith(prefix);
    }

    return false;
  }

  /**
   * Check if request method is allowed for route
   * @param {string} requestMethod - HTTP method
   * @param {array} routeMethods - Allowed methods for route
   * @returns {boolean}
   */
  matchesMethod(requestMethod, routeMethods) {
    // If no methods specified, allow all
    if (!routeMethods || routeMethods.length === 0) {
      return true;
    }

    return routeMethods.some(m => m.toUpperCase() === requestMethod.toUpperCase());
  }

  /**
   * Transform request path based on route configuration
   * @param {string} requestPath - Original request path
   * @param {object} route - Matched route
   * @returns {string} - Transformed path for backend
   */
  transformPath(requestPath, route) {
    if (!route.pathRewrite) {
      return requestPath;
    }

    const normalizedRoute = route.path.replace(/\/+$/, '');
    if (!requestPath.startsWith(normalizedRoute)) return requestPath;

    // Suffix is everything after the route prefix (e.g. /123 or '')
    const suffix = requestPath.slice(normalizedRoute.length);

    let transformed;
    if (typeof route.pathRewrite === 'string') {
      // String rewrite: replace route prefix with the given base path
      // e.g. pathRewrite: '/users', route: '/api/users', path: '/api/users/123' → '/users/123'
      const base = route.pathRewrite.replace(/\/+$/, '');
      transformed = base + suffix || '/';
    } else {
      // Boolean true: strip route prefix completely
      // e.g. /api/auth/login → /login
      transformed = suffix || '/';
    }

    logger.debug('Path transformed', { original: requestPath, transformed });
    return transformed;
  }

  /**
   * Update routes (for hot reload)
   * @param {array} newRoutes - New route configurations
   */
  updateRoutes(newRoutes) {
    this.routes = newRoutes;
    logger.info('Routes updated', { count: newRoutes.length });
  }
}

module.exports = RouteMatcher;
