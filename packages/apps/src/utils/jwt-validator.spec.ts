import jwt from 'jsonwebtoken';

import { JwtValidator, createEntraTokenValidator, createServiceTokenValidator } from './jwt-validator';

// Mock dependencies
jest.mock('jsonwebtoken', () => ({
  ...jest.requireActual('jsonwebtoken'),
  decode: jest.fn(),
  verify: jest.fn(),
}));

jest.mock('jwks-rsa', () => {
  return jest.fn(() => ({
    getSigningKey: jest.fn()
  }));
});

const mockDate = new Date('2025-01-15T12:00:00Z');
const mockClientId = 'test-client-id';
const mockTenantId = 'test-tenant-id';
const mockLogger = {
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  log: jest.fn(),
  child: jest.fn().mockReturnThis(),
};

const mockToken = {
  header: {
    kid: 'test-kid',
    alg: 'RS256',
    typ: 'JWT',
  },
  payload: {
    iat: Math.floor(mockDate.getTime() / 1000 - 300), // 5 minutes ago
    exp: Math.floor(mockDate.getTime() / 1000 + 300), // 5 minutes from now
    aud: mockClientId,
    iss: `https://login.microsoftonline.com/${mockTenantId}/v2.0`,
    scp: 'User.Read',
    serviceurl: 'https://example.com/api',
  },
};

// Mock jwks-rsa
const mockGetSigningKey = jest.fn();
jest.mock('jwks-rsa', () => {
  return jest.fn(() => ({
    getSigningKey: mockGetSigningKey
  }));
});

describe('JwtValidator', () => {
  let mockVerifyToken: jest.Mock<void, [string, jwt.GetPublicKeyOrSecret, jwt.VerifyOptions, jwt.VerifyCallback]>;
  let mockDecodeToken: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(mockDate);

    // Setup JWT mocks
    mockVerifyToken = jwt.verify as jest.Mock;
    mockDecodeToken = jwt.decode as jest.Mock;

    mockDecodeToken.mockReturnValue({
      header: mockToken.header,
      payload: mockToken.payload,
    });

    // Default successful verification
    mockVerifyToken.mockImplementation((_token, _getKey, _options, callback) => {
      callback(null, mockToken.payload);
    });

    // Default successful key retrieval
    mockGetSigningKey.mockImplementation((_kid, callback) => {
      callback(null, {
        getPublicKey: () => 'mock-public-key',
        publicKey: 'mock-public-key'
      });
    });

    // Clear all mocks
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  describe('validateAccessToken', () => {
    describe('basic validation', () => {
      it('should throw error for empty token', async () => {
        const validator = new JwtValidator({
          clientId: mockClientId,
          tenantId: mockTenantId,
          jwksUriOptions: { type: 'tenantId' }
        });

        await expect(validator.validateAccessToken('')).rejects.toThrow('No token provided');
      });

      it('should return null for invalid JWT', async () => {
        const validator = new JwtValidator({
          clientId: mockClientId,
          tenantId: mockTenantId,
          jwksUriOptions: { type: 'tenantId' }
        }, mockLogger);

        mockVerifyToken.mockImplementation((_token, _getKey, _options, callback) => {
          callback(new jwt.JsonWebTokenError('Invalid token'));
        });

        const result = await validator.validateAccessToken('invalid-token');

        expect(result).toBeNull();
        expect(mockLogger.error).toHaveBeenCalledWith('JWT verification failed:', expect.any(Error));
      });

      it('should return payload for valid token', async () => {
        const validator = new JwtValidator({
          clientId: mockClientId,
          tenantId: mockTenantId,
          jwksUriOptions: { type: 'tenantId' }
        });

        const result = await validator.validateAccessToken('valid-token');

        expect(result).toEqual(mockToken.payload);
      });

      it('should handle JWKS key retrieval errors', async () => {
        const validator = new JwtValidator({
          clientId: mockClientId,
          tenantId: mockTenantId,
          jwksUriOptions: { type: 'tenantId' }
        }, mockLogger);

        mockGetSigningKey.mockImplementation((_kid, callback) => {
          callback(new Error('Key not found'), null);
        });

        mockVerifyToken.mockImplementation((_token, getKey, _options, callback) => {
          getKey({ kid: 'test-kid', alg: 'RS256' }, (err, _key) => {
            if (err) {
              callback(err as jwt.JsonWebTokenError);
            } else {
              callback(null, mockToken.payload);
            }
          });
        });

        const result = await validator.validateAccessToken('valid-token');

        expect(result).toBeNull();
        expect(mockLogger.error).toHaveBeenCalledWith('JWT verification failed:', expect.any(Error));
      });
    });

    describe('audience validation', () => {
      it('should accept clientId audience by default', async () => {
        const validator = new JwtValidator({
          clientId: mockClientId,
          tenantId: mockTenantId,
          jwksUriOptions: { type: 'tenantId' }
        });

        const result = await validator.validateAccessToken('valid-token');

        expect(result).toEqual(mockToken.payload);
        expect(mockVerifyToken).toHaveBeenCalledWith(
          'valid-token',
          expect.any(Function),
          expect.objectContaining({
            audience: [mockClientId, `api://${mockClientId}`]
          }),
          expect.any(Function)
        );
      });

      it('should accept botFramework audience when configured', async () => {
        const validator = new JwtValidator({
          clientId: mockClientId,
          tenantId: mockTenantId,
          jwksUriOptions: { type: 'tenantId' },
          validateAudience: ['botFramework']
        });

        const result = await validator.validateAccessToken('valid-token');

        expect(result).toEqual(mockToken.payload);
        expect(mockVerifyToken).toHaveBeenCalledWith(
          'valid-token',
          expect.any(Function),
          expect.objectContaining({
            audience: ['https://api.botframework.com']
          }),
          expect.any(Function)
        );
      });

      it('should accept multiple audience types', async () => {
        const validator = new JwtValidator({
          clientId: mockClientId,
          tenantId: mockTenantId,
          jwksUriOptions: { type: 'tenantId' },
          validateAudience: ['clientId', 'botFramework']
        });

        const result = await validator.validateAccessToken('valid-token');

        expect(result).toEqual(mockToken.payload);
        expect(mockVerifyToken).toHaveBeenCalledWith(
          'valid-token',
          expect.any(Function),
          expect.objectContaining({
            audience: [mockClientId, `api://${mockClientId}`, 'https://api.botframework.com']
          }),
          expect.any(Function)
        );
      });
    });

    describe('issuer validation', () => {
      it('should skip issuer validation when not configured', async () => {
        const validator = new JwtValidator({
          clientId: mockClientId,
          tenantId: mockTenantId,
          jwksUriOptions: { type: 'tenantId' }
        });

        const result = await validator.validateAccessToken('valid-token');

        expect(result).toEqual(mockToken.payload);
      });

      it('should validate specific allowed issuer', async () => {
        const validator = new JwtValidator({
          clientId: mockClientId,
          tenantId: mockTenantId,
          jwksUriOptions: { type: 'tenantId' },
          validateIssuer: { allowedIssuer: 'https://trusted-issuer.com' }
        }, mockLogger);

        const result = await validator.validateAccessToken('valid-token');

        expect(result).toBeNull();
        expect(mockLogger.error).toHaveBeenCalledWith(
          'Custom validation failed:',
          expect.objectContaining({
            message: expect.stringContaining('does not match allowed issuer')
          })
        );
      });

      it('should accept valid specific issuer', async () => {
        const validator = new JwtValidator({
          clientId: mockClientId,
          tenantId: mockTenantId,
          jwksUriOptions: { type: 'tenantId' },
          validateIssuer: { allowedIssuer: `https://login.microsoftonline.com/${mockTenantId}/v2.0` }
        });

        const result = await validator.validateAccessToken('valid-token');

        expect(result).toEqual(mockToken.payload);
      });

      it('should validate tenant-based issuer for single-tenant apps', async () => {
        const validator = new JwtValidator({
          clientId: mockClientId,
          tenantId: mockTenantId,
          jwksUriOptions: { type: 'tenantId' },
          validateIssuer: { allowedTenantIds: ['different-tenant'] }
        });

        const result = await validator.validateAccessToken('valid-token');

        expect(result).toEqual(mockToken.payload); // Single-tenant ignores allowedTenantIds
      });

      it('should validate tenant-based issuer for multi-tenant apps', async () => {
        const validator = new JwtValidator({
          clientId: mockClientId,
          tenantId: 'common',
          jwksUriOptions: { type: 'tenantId' },
          validateIssuer: { allowedTenantIds: [mockTenantId] }
        });

        const result = await validator.validateAccessToken('valid-token');

        expect(result).toEqual(mockToken.payload);
      });

      it('should reject invalid tenant issuer for multi-tenant apps', async () => {
        const validator = new JwtValidator({
          clientId: mockClientId,
          tenantId: 'common',
          jwksUriOptions: { type: 'tenantId' },
          validateIssuer: { allowedTenantIds: ['different-tenant'] }
        }, mockLogger);

        const result = await validator.validateAccessToken('valid-token');

        expect(result).toBeNull();
        expect(mockLogger.error).toHaveBeenCalledWith(
          'Custom validation failed:',
          expect.objectContaining({
            message: expect.stringContaining('not in allowed tenant IDs')
          })
        );
      });

      it('should reject token with missing issuer', async () => {
        const validator = new JwtValidator({
          clientId: mockClientId,
          tenantId: mockTenantId,
          jwksUriOptions: { type: 'tenantId' },
          validateIssuer: { allowedIssuer: 'https://trusted-issuer.com' }
        }, mockLogger);

        mockVerifyToken.mockImplementation((_token, _getKey, _options, callback) => {
          callback(null, { ...mockToken.payload, iss: undefined });
        });

        const result = await validator.validateAccessToken('valid-token');

        expect(result).toBeNull();
        expect(mockLogger.error).toHaveBeenCalledWith(
          'Custom validation failed:',
          expect.objectContaining({
            message: 'Token missing issuer claim'
          })
        );
      });
    });

    describe('scope validation', () => {
      it('should skip scope validation when not configured', async () => {
        const validator = new JwtValidator({
          clientId: mockClientId,
          tenantId: mockTenantId,
          jwksUriOptions: { type: 'tenantId' }
        });

        const result = await validator.validateAccessToken('valid-token');

        expect(result).toEqual(mockToken.payload);
      });

      it('should validate required scope', async () => {
        const validator = new JwtValidator({
          clientId: mockClientId,
          tenantId: mockTenantId,
          jwksUriOptions: { type: 'tenantId' },
          validateScope: { requiredScope: 'User.Read' }
        });

        const result = await validator.validateAccessToken('valid-token');

        expect(result).toEqual(mockToken.payload);
      });

      it('should reject token with missing scope', async () => {
        const validator = new JwtValidator({
          clientId: mockClientId,
          tenantId: mockTenantId,
          jwksUriOptions: { type: 'tenantId' },
          validateScope: { requiredScope: 'Admin.ReadWrite' }
        }, mockLogger);

        const result = await validator.validateAccessToken('valid-token');

        expect(result).toBeNull();
        expect(mockLogger.error).toHaveBeenCalledWith(
          'Custom validation failed:',
          expect.objectContaining({
            message: 'Token missing required scope: Admin.ReadWrite'
          })
        );
      });

      it('should handle undefined scope in token', async () => {
        const validator = new JwtValidator({
          clientId: mockClientId,
          tenantId: mockTenantId,
          jwksUriOptions: { type: 'tenantId' },
          validateScope: { requiredScope: 'User.Read' }
        }, mockLogger);

        mockVerifyToken.mockImplementation((_token, _getKey, _options, callback) => {
          callback(null, { ...mockToken.payload, scp: undefined });
        });

        const result = await validator.validateAccessToken('valid-token');

        expect(result).toBeNull();
        expect(mockLogger.error).toHaveBeenCalledWith(
          'Custom validation failed:',
          expect.objectContaining({
            message: 'Token missing required scope: User.Read'
          })
        );
      });
    });

    describe('service URL validation', () => {
      it('should skip service URL validation when not configured', async () => {
        const validator = new JwtValidator({
          clientId: mockClientId,
          tenantId: mockTenantId,
          jwksUriOptions: { type: 'tenantId' }
        });

        const result = await validator.validateAccessToken('valid-token');

        expect(result).toEqual(mockToken.payload);
      });

      it('should validate matching service URL', async () => {
        const validator = new JwtValidator({
          clientId: mockClientId,
          tenantId: mockTenantId,
          jwksUriOptions: { type: 'tenantId' },
          validateServiceUrl: { expectedServiceUrl: 'https://example.com/api' }
        });

        const result = await validator.validateAccessToken('valid-token');

        expect(result).toEqual(mockToken.payload);
      });

      it('should normalize service URLs (remove trailing slash)', async () => {
        const validator = new JwtValidator({
          clientId: mockClientId,
          tenantId: mockTenantId,
          jwksUriOptions: { type: 'tenantId' },
          validateServiceUrl: { expectedServiceUrl: 'https://example.com/api/' }
        });

        const result = await validator.validateAccessToken('valid-token');

        expect(result).toEqual(mockToken.payload);
      });

      it('should reject token with missing service URL', async () => {
        const validator = new JwtValidator({
          clientId: mockClientId,
          tenantId: mockTenantId,
          jwksUriOptions: { type: 'tenantId' },
          validateServiceUrl: { expectedServiceUrl: 'https://example.com/api' }
        }, mockLogger);

        mockVerifyToken.mockImplementation((_token, _getKey, _options, callback) => {
          callback(null, { ...mockToken.payload, serviceurl: undefined });
        });

        const result = await validator.validateAccessToken('valid-token');

        expect(result).toBeNull();
        expect(mockLogger.error).toHaveBeenCalledWith(
          'Custom validation failed:',
          expect.objectContaining({
            message: 'Token missing serviceurl claim'
          })
        );
      });

      it('should reject token with mismatched service URL', async () => {
        const validator = new JwtValidator({
          clientId: mockClientId,
          tenantId: mockTenantId,
          jwksUriOptions: { type: 'tenantId' },
          validateServiceUrl: { expectedServiceUrl: 'https://different.com/api' }
        }, mockLogger);

        const result = await validator.validateAccessToken('valid-token');

        expect(result).toBeNull();
        expect(mockLogger.error).toHaveBeenCalledWith(
          'Custom validation failed:',
          expect.objectContaining({
            message: expect.stringContaining('Service URL mismatch')
          })
        );
      });
    });

    describe('override options', () => {
      it('should override scope validation per request', async () => {
        const validator = new JwtValidator({
          clientId: mockClientId,
          tenantId: mockTenantId,
          jwksUriOptions: { type: 'tenantId' },
          validateScope: { requiredScope: 'User.Read' }
        });

        const result = await validator.validateAccessToken('valid-token', {
          validateScope: { requiredScope: 'Admin.ReadWrite' }
        });

        expect(result).toBeNull(); // Should fail because token has 'User.Read' not 'Admin.ReadWrite'
      });

      it('should override service URL validation per request', async () => {
        const validator = new JwtValidator({
          clientId: mockClientId,
          tenantId: mockTenantId,
          jwksUriOptions: { type: 'tenantId' },
          validateServiceUrl: { expectedServiceUrl: 'https://example.com/api' }
        });

        const result = await validator.validateAccessToken('valid-token', {
          validateServiceUrl: { expectedServiceUrl: 'https://different.com/api' }
        });

        expect(result).toBeNull(); // Should fail because URLs don't match
      });

      it('should add validation when not configured in constructor', async () => {
        const validator = new JwtValidator({
          clientId: mockClientId,
          tenantId: mockTenantId,
          jwksUriOptions: { type: 'tenantId' }
        });

        const result = await validator.validateAccessToken('valid-token', {
          validateScope: { requiredScope: 'User.Read' }
        });

        expect(result).toEqual(mockToken.payload);
      });
    });

    describe('JWKS URI options', () => {
      it('should use tenant-based JWKS URI', async () => {
        const validator = new JwtValidator({
          clientId: mockClientId,
          tenantId: mockTenantId,
          jwksUriOptions: { type: 'tenantId' }
        });

        await validator.validateAccessToken('valid-token');

        // Should create JWKS client with tenant-specific URI
        expect(validator.options.jwksUriOptions).toEqual({ type: 'tenantId' });
      });

      it('should use custom JWKS URI', async () => {
        const customUri = 'https://custom-issuer.com/.well-known/jwks.json';
        const validator = new JwtValidator({
          clientId: mockClientId,
          tenantId: mockTenantId,
          jwksUriOptions: { type: 'uri', uri: customUri }
        });

        await validator.validateAccessToken('valid-token');

        expect(validator.options.jwksUriOptions).toEqual({ type: 'uri', uri: customUri });
      });
    });

    describe('clock tolerance', () => {
      it('should use default clock tolerance', async () => {
        const validator = new JwtValidator({
          clientId: mockClientId,
          tenantId: mockTenantId,
          jwksUriOptions: { type: 'tenantId' }
        });

        await validator.validateAccessToken('valid-token');

        expect(mockVerifyToken).toHaveBeenCalledWith(
          'valid-token',
          expect.any(Function),
          expect.objectContaining({
            clockTolerance: 300 // 5 minutes default
          }),
          expect.any(Function)
        );
      });

      it('should use custom clock tolerance', async () => {
        const validator = new JwtValidator({
          clientId: mockClientId,
          tenantId: mockTenantId,
          jwksUriOptions: { type: 'tenantId' },
          clockTolerance: 600 // 10 minutes
        });

        await validator.validateAccessToken('valid-token');

        expect(mockVerifyToken).toHaveBeenCalledWith(
          'valid-token',
          expect.any(Function),
          expect.objectContaining({
            clockTolerance: 600
          }),
          expect.any(Function)
        );
      });
    });
  });

  describe('factory functions', () => {
    describe('createEntraTokenValidator', () => {
      it('should create validator with minimal options', () => {
        const validator = createEntraTokenValidator(mockTenantId, mockClientId);

        expect(validator).toBeInstanceOf(JwtValidator);
        expect(validator.options.clientId).toBe(mockClientId);
        expect(validator.options.tenantId).toBe(mockTenantId);
        expect(validator.options.jwksUriOptions).toEqual({ type: 'tenantId' });
      });

      it('should create validator with all options', () => {
        const validator = createEntraTokenValidator(mockTenantId, mockClientId, {
          allowedTenantIds: ['tenant1', 'tenant2'],
          requiredScope: 'User.Read',
          logger: mockLogger
        });

        expect(validator).toBeInstanceOf(JwtValidator);
        expect(validator.options.validateIssuer).toEqual({
          allowedTenantIds: ['tenant1', 'tenant2']
        });
        expect(validator.options.validateScope).toEqual({
          requiredScope: 'User.Read'
        });
      });

      it('should create validator without scope when not provided', () => {
        const validator = createEntraTokenValidator(mockTenantId, mockClientId, {
          allowedTenantIds: ['tenant1']
        });

        expect(validator.options.validateScope).toBeUndefined();
      });
    });

    describe('createServiceTokenValidator', () => {
      it('should create validator with minimal options', () => {
        const validator = createServiceTokenValidator(mockClientId, mockTenantId);

        expect(validator).toBeInstanceOf(JwtValidator);
        expect(validator.options.clientId).toBe(mockClientId);
        expect(validator.options.tenantId).toBe(mockTenantId);
        expect(validator.options.validateIssuer).toEqual({
          allowedIssuer: 'https://api.botframework.com'
        });
        expect(validator.options.jwksUriOptions).toEqual({
          type: 'uri',
          uri: 'https://login.botframework.com/v1/.well-known/keys'
        });
      });

      it('should create validator with service URL', () => {
        const serviceUrl = 'https://example.com/api';
        const validator = createServiceTokenValidator(mockClientId, mockTenantId, serviceUrl);

        expect(validator.options.validateServiceUrl).toEqual({
          expectedServiceUrl: serviceUrl
        });
      });

      it('should create validator without service URL validation when not provided', () => {
        const validator = createServiceTokenValidator(mockClientId, mockTenantId);

        expect(validator.options.validateServiceUrl).toBeUndefined();
      });

      it('should create validator with logger', () => {
        const validator = createServiceTokenValidator(mockClientId, mockTenantId, undefined, mockLogger);

        expect(validator).toBeInstanceOf(JwtValidator);
      });
    });
  });

  describe('error handling and logging', () => {
    it('should log JWT verification errors', async () => {
      const validator = new JwtValidator({
        clientId: mockClientId,
        tenantId: mockTenantId,
        jwksUriOptions: { type: 'tenantId' }
      }, mockLogger);

      mockVerifyToken.mockImplementation((_token, _getKey, _options, callback) => {
        callback(new jwt.JsonWebTokenError('Token expired'));
      });

      const result = await validator.validateAccessToken('expired-token');

      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'JWT verification failed:',
        expect.any(Error)
      );
    });

    it('should log custom validation errors', async () => {
      const validator = new JwtValidator({
        clientId: mockClientId,
        tenantId: mockTenantId,
        jwksUriOptions: { type: 'tenantId' },
        validateScope: { requiredScope: 'Admin.ReadWrite' }
      }, mockLogger);

      const result = await validator.validateAccessToken('valid-token');

      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Custom validation failed:',
        expect.any(Error)
      );
    });

    it('should log JWKS key retrieval errors', async () => {
      const validator = new JwtValidator({
        clientId: mockClientId,
        tenantId: mockTenantId,
        jwksUriOptions: { type: 'tenantId' }
      }, mockLogger);

      mockGetSigningKey.mockImplementation((_kid, callback) => {
        callback(new Error('Network error'), null);
      });

      // Mock jwt.verify to call getSigningKey
      mockVerifyToken.mockImplementation((_token, getKey, _options, callback) => {
        getKey({ kid: 'test-kid', alg: 'RS256' }, (err, _key) => {
          if (err) {
            callback(err as jwt.JsonWebTokenError);
          } else {
            callback(null, mockToken.payload);
          }
        });
      });

      const result = await validator.validateAccessToken('valid-token');

      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        'JWT verification failed:',
        expect.any(Error)
      );
    });
  });
});