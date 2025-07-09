import jwt from 'jsonwebtoken';

import { createEntraTokenValidator } from './configurable-jwt-validator';

const mockDate = new Date('2025-10-01T00:00:00Z');
const mockClientId = 'mock-client-id';
const mockTenantId = 'mock-tenant-id';
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
    kid: 'mock-kid',
    alg: 'RS256',
    typ: 'JWT',
  },
  signature: 'verified',
  payload: {
    iat: Math.floor(mockDate.getTime() / 1000 - 60),
    exp: Math.floor(mockDate.getTime() / 1000 + 60),
    scp: 'access_as_user',
    aud: `api://${mockClientId}`,
    iss: `https://login.microsoftonline.com/${mockTenantId}/v2.0`,
  },
};

// Mock network calls
global.fetch = jest.fn(() =>
  Promise.reject(new Error('Network error')),
) as jest.Mock;

// Mock jwks-rsa - this is what does the actual network fetch
const mockGetSigningKey = jest.fn((_kid, callback) => {
  // Simulate successful key retrieval
  const mockSigningKey = {
    getPublicKey: () => 'mock-public-key',
    publicKey: 'mock-public-key'
  };
  callback(null, mockSigningKey);
});

// Mock the jwks-rsa default export (which is a function that returns a JwksClient)
jest.mock('jwks-rsa', () => {
  return jest.fn(() => ({
    getSigningKey: mockGetSigningKey
  }));
});

jest.mock('jsonwebtoken', () => {
  return { ...jest.requireActual('jsonwebtoken'), decode: jest.fn(), verify: jest.fn() };
});


describe('createEntraTokenValidator', () => {
  let mockVerifyToken: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(mockDate);

    // Mock jwt functions for the configurable validator
    const mockDecodeToken = jwt.decode as jest.Mock;
    mockVerifyToken = jwt.verify as jest.Mock;
    mockDecodeToken.mockImplementation(() => ({ header: mockToken.header, payload: mockToken.payload }));
    mockVerifyToken.mockImplementation((_token, _getKey, _options, callback) => {
      // Simulate successful verification by calling the callback with the payload
      callback(null, mockToken.payload);
    });

    // Reset jwks-rsa mock and logger mock
    mockGetSigningKey.mockClear();
    mockLogger.error.mockClear();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });


  describe('validateAccessToken', () => {
    it('should throw error if no token is provided', async () => {
      const entraTokenValidator = createEntraTokenValidator(mockTenantId, mockClientId);
      await expect(entraTokenValidator.validateAccessToken('')).rejects.toThrow('No token provided');
    });

    it('should return null if the token cannot be decoded', async () => {
      mockVerifyToken.mockImplementation((_token, _getKey, _options, callback) => {
        callback(new Error('invalid token'), null);
      });

      const entraTokenValidator = createEntraTokenValidator(mockTenantId, mockClientId, { logger: mockLogger });
      const result = await entraTokenValidator.validateAccessToken('invalid-token');
      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('JWT verification failed'), expect.any(Error)
      );
    });

    it('should return null if public key can not be found', async () => {
      mockGetSigningKey.mockImplementation((_kid, callback) => {
        callback(new Error('Key not found'), null);
      });

      // Mock jwt.verify to actually call the getSigningKey callback
      mockVerifyToken.mockImplementation((_token, getKey, _options, callback) => {
        getKey({ kid: 'test-kid' }, (err: any, _key: any) => {
          if (err) {
            callback(err, null);
          } else {
            callback(null, mockToken.payload);
          }
        });
      });

      const entraTokenValidator = createEntraTokenValidator(mockTenantId, mockClientId, { logger: mockLogger });
      const result = await entraTokenValidator.validateAccessToken('bearer-token');
      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to get signing key'), expect.any(Error)
      );
    });

    it('should return null if public key can not be fetched', async () => {
      mockGetSigningKey.mockImplementation((_kid, callback) => {
        callback(new Error('Public key fetch error'), null);
      });

      // Mock jwt.verify to actually call the getSigningKey callback
      mockVerifyToken.mockImplementation((_token, getKey, _options, callback) => {
        getKey({ kid: 'test-kid' }, (err: any, _key: any) => {
          if (err) {
            callback(err, null);
          } else {
            callback(null, mockToken.payload);
          }
        });
      });

      const entraTokenValidator = createEntraTokenValidator(mockTenantId, mockClientId, { logger: mockLogger });
      const result = await entraTokenValidator.validateAccessToken('bearer-token');
      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to get signing key'), expect.any(Error)
      );
    });

    it('should return null if token signature can not be verified', async () => {
      mockVerifyToken.mockImplementation((_token, _getKey, _options, callback) => {
        callback(new Error('JWT signature verification failed'), null);
      });

      const entraTokenValidator = createEntraTokenValidator(mockTenantId, mockClientId, { logger: mockLogger });
      const result = await entraTokenValidator.validateAccessToken('bearer-token');
      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('JWT verification failed'), expect.any(Error)
      );
    });
  });

  describe('validateTokenClaims', () => {
    it.each`
      tokenScp             | requiredScope        | description
      ${undefined}         | ${undefined}         | ${'no scope is present or required'}
      ${'access_as_user'}  | ${undefined}         | ${'no scope is required'}
      ${'access_as_santa'} | ${'access_as_santa'} | ${'the requested scope is present'}
    `('returns a token when $description', async ({ tokenScp, requiredScope }) => {
      const expectedPayload = { ...mockToken.payload, scp: tokenScp };

      mockVerifyToken.mockImplementation((_token, _getKey, _options, callback) => {
        callback(null, expectedPayload);
      });

      const entraTokenValidator = createEntraTokenValidator(mockTenantId, mockClientId, { requiredScope });

      const result = await entraTokenValidator.validateAccessToken('bearer-token');
      expect(result).toEqual(expectedPayload);
    });

    it.each`
      audience
      ${mockClientId}
      ${`api://${mockClientId}`}
    `('returns a token when audience is $audience', async ({ audience }) => {
      const expectedPayload = { ...mockToken.payload, aud: audience };

      mockVerifyToken.mockImplementation((_token, _getKey, _options, callback) => {
        callback(null, expectedPayload);
      });

      const entraTokenValidator = createEntraTokenValidator(mockTenantId, mockClientId);

      const result = await entraTokenValidator.validateAccessToken('bearer-token');
      expect(result).toEqual(expectedPayload);
    });

    it.each`
      tenantId        | allowedTenantIds                      | description
      ${'common'}     | ${undefined}                          | ${'allowedTenantIds is undefined'}
      ${mockTenantId} | ${['unrelated-tenant']}               | ${'allowedTenantIds is set to some unrelated tenant'}
      ${'common'}     | ${['unrelated-tenant', mockTenantId]} | ${'allowedTenantIds includes the token issuer'}
    `(
      'returns a token when tenantId is $tenantId and $description',
      async ({ tenantId, allowedTenantIds }) => {
        const expectedPayload = {
          ...mockToken.payload,
          iss: `https://login.microsoftonline.com/${mockTenantId}/`,
        };

        mockVerifyToken.mockImplementation((_token, _getKey, _options, callback) => {
          callback(null, expectedPayload);
        });

        const entraTokenValidator = createEntraTokenValidator(tenantId, mockClientId, { allowedTenantIds });

        const result = await entraTokenValidator.validateAccessToken('bearer-token');
        expect(result).toEqual(expectedPayload);
      }
    );

    it('should pass when single-tenant app has allowedTenantIds but token is from app tenant', async () => {
      const expectedPayload = {
        ...mockToken.payload,
        iss: `https://login.microsoftonline.com/${mockTenantId}/`,
      };

      mockVerifyToken.mockImplementation((_token, _getKey, _options, callback) => {
        callback(null, expectedPayload);
      });

      // For single-tenant apps, allowedTenantIds should be ignored and only the app's tenant should be valid
      const entraTokenValidator = createEntraTokenValidator(mockTenantId, mockClientId, {
        allowedTenantIds: ['unrelated-tenant']
      });

      // This should PASS because for single-tenant apps, allowedTenantIds is ignored and tokens from the app's own tenant are always accepted
      const result = await entraTokenValidator.validateAccessToken('bearer-token');
      expect(result).toEqual(expectedPayload);
    });

    it('should return null when single-tenant app receives token from different tenant', async () => {
      const expectedPayload = {
        ...mockToken.payload,
        iss: 'https://login.microsoftonline.com/different-tenant/',
      };

      mockVerifyToken.mockImplementation((_token, _getKey, _options, callback) => {
        callback(null, expectedPayload);
      });

      // For single-tenant apps, only tokens from the app's own tenant should be accepted
      const entraTokenValidator = createEntraTokenValidator(mockTenantId, mockClientId, { logger: mockLogger });

      // This should return null because the token is from a different tenant than the app's tenant
      const result = await entraTokenValidator.validateAccessToken('bearer-token');
      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Custom validation failed'), 
        expect.objectContaining({
          message: expect.stringContaining('not in allowed tenant IDs')
        })
      );
    });

    it('should return null if token payload is missing', async () => {
      const entraTokenValidator = createEntraTokenValidator(mockTenantId, mockClientId);

      // Mock jwt.verify to return token with undefined payload
      mockVerifyToken.mockImplementation((_token, _getKey, _options, callback) => {
        callback(null, undefined);
      });

      const result = await entraTokenValidator.validateAccessToken('bearer-token');
      expect(result).toBeNull();
    });

    it('should return null if token issued-at value is missing', async () => {
      const entraTokenValidator = createEntraTokenValidator(mockTenantId, mockClientId, { logger: mockLogger });

      // Mock jwt.verify to simulate missing iat validation failure
      mockVerifyToken.mockImplementation((_token, _getKey, _options, callback) => {
        callback(new Error('jwt malformed'), null);
      });

      const result = await entraTokenValidator.validateAccessToken('bearer-token');
      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('JWT verification failed'), expect.any(Error)
      );
    });

    it('should return null if token issued-at value is in the future', async () => {
      const entraTokenValidator = createEntraTokenValidator(mockTenantId, mockClientId);

      // Mock jwt.verify to simulate future iat validation failure
      mockVerifyToken.mockImplementation((_token, _getKey, _options, callback) => {
        callback(new Error('jwt issued at future date'), null);
      });

      const result = await entraTokenValidator.validateAccessToken('bearer-token');
      expect(result).toBeNull();
    });

    it('should return null if token expires-at value is missing', async () => {
      const entraTokenValidator = createEntraTokenValidator(mockTenantId, mockClientId);

      // Mock jwt.verify to simulate missing exp validation failure
      mockVerifyToken.mockImplementation((_token, _getKey, _options, callback) => {
        callback(new Error('jwt malformed'), null);
      });

      const result = await entraTokenValidator.validateAccessToken('bearer-token');
      expect(result).toBeNull();
    });

    it('should return null if token expires-at value is in the past', async () => {
      const entraTokenValidator = createEntraTokenValidator(mockTenantId, mockClientId, { logger: mockLogger });

      // Mock jwt.verify to simulate expired token validation failure
      mockVerifyToken.mockImplementation((_token, _getKey, _options, callback) => {
        callback(new Error('jwt expired'), null);
      });

      const result = await entraTokenValidator.validateAccessToken('bearer-token');
      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('JWT verification failed'), expect.any(Error)
      );
    });

    it('should return null if audience is missing', async () => {
      const entraTokenValidator = createEntraTokenValidator(mockTenantId, mockClientId);

      // Mock jwt.verify to simulate missing audience validation failure
      mockVerifyToken.mockImplementation((_token, _getKey, _options, callback) => {
        callback(new Error('jwt audience invalid'), null);
      });

      const result = await entraTokenValidator.validateAccessToken('bearer-token');
      expect(result).toBeNull();
    });

    it('should return null if audience is unexpected', async () => {
      const entraTokenValidator = createEntraTokenValidator(mockTenantId, mockClientId);

      // Mock jwt.verify to simulate wrong audience validation failure
      mockVerifyToken.mockImplementation((_token, _getKey, _options, callback) => {
        callback(new Error('jwt audience invalid'), null);
      });

      const result = await entraTokenValidator.validateAccessToken('bearer-token');
      expect(result).toBeNull();
    });

    it('should return null if issuer is missing', async () => {
      const entraTokenValidator = createEntraTokenValidator(mockTenantId, mockClientId, { logger: mockLogger });

      // Mock the shared utility to return payload with missing issuer
      const payloadWithoutIssuer = { ...mockToken.payload, iss: undefined };
      mockVerifyToken.mockImplementation((_token, _getKey, _options, callback) => {
        callback(null, payloadWithoutIssuer);
      });

      const result = await entraTokenValidator.validateAccessToken('bearer-token');
      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Custom validation failed'), 
        expect.objectContaining({
          message: expect.stringContaining('Token missing issuer claim')
        })
      );
    });

    it('should return null if issuer is unexpected', async () => {
      const entraTokenValidator = createEntraTokenValidator(mockTenantId, mockClientId, { logger: mockLogger });

      // Mock the shared utility to return payload with unexpected issuer
      const payloadWithUnexpectedIssuer = {
        ...mockToken.payload,
        iss: 'https://login.microsoftonline.com/some-other-tenant/v2.0',
      };
      mockVerifyToken.mockImplementation((_token, _getKey, _options, callback) => {
        callback(null, payloadWithUnexpectedIssuer);
      });

      const result = await entraTokenValidator.validateAccessToken('bearer-token');
      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Custom validation failed'), 
        expect.objectContaining({
          message: expect.stringContaining('not in allowed tenant IDs')
        })
      );
    });

    it('should return null if token is issued for the wrong scope', async () => {
      const entraTokenValidator = createEntraTokenValidator(mockTenantId, mockClientId, {
        requiredScope: 'access_as_santa_claus',
        logger: mockLogger,
      },);

      mockVerifyToken.mockImplementation((_token, _getKey, _options, callback) => {
        callback(null, mockToken.payload);
      });

      const result = await entraTokenValidator.validateAccessToken('bearer-token');
      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Custom validation failed'), 
        expect.objectContaining({
          message: expect.stringContaining('Token missing required scope')
        })
      );
    });
  });
});
