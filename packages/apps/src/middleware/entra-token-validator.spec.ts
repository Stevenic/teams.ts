import jwt from 'jsonwebtoken';

import * as EntraTokenValidatorComponent from './entra-token-validator';
import { JwksKeyRetriever } from './jwks-key-retriever';
import * as jwtUtils from './jwt-utils';


const { EntraTokenValidator, getJwksClient } = EntraTokenValidatorComponent;

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

jest.mock('jsonwebtoken', () => {
  return { ...jest.requireActual('jsonwebtoken'), decode: jest.fn(), verify: jest.fn() };
});
jest.mock('./jwt-utils', () => ({
  decodeJwt: jest.fn(),
  verifyJwtSignature: jest.fn(),
  validateTokenTime: jest.fn(),
}));
jest.mock('./jwks-key-retriever');

describe('getJwksClient', () => {
  it('should return a JWKS client with the correct URI', () => {
    const jwksClient = getJwksClient({
      jwksUri: 'https://login.microsoftonline.com/mock-tenant-id/discovery/v2.0/keys',
    });
    expect(jwksClient).toBeDefined();
    expect(jwksClient).toHaveProperty('getSigningKey', expect.any(Function));
    expect(jwksClient).toHaveProperty('options', {
      cache: true,
      jwksUri: 'https://login.microsoftonline.com/mock-tenant-id/discovery/v2.0/keys',
      rateLimit: false,
      timeout: 30000,
    });
  });
});

describe('EntraTokenValidator', () => {
  const mockJwtUtils = jwtUtils as jest.Mocked<typeof jwtUtils>;
  const MockedJwksKeyRetriever = JwksKeyRetriever as jest.MockedClass<typeof JwksKeyRetriever>;
  let mockKeyRetrieverInstance: any;
  let mockVerifyToken: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(mockDate);

    // Mock the shared utilities
    mockKeyRetrieverInstance = {
      getPublicKey: jest.fn(),
    };
    MockedJwksKeyRetriever.mockImplementation(() => mockKeyRetrieverInstance);

    // Setup default successful responses for shared utilities
    mockJwtUtils.decodeJwt.mockReturnValue({
      success: true,
      data: {
        header: mockToken.header,
        payload: mockToken.payload,
      },
    });

    mockJwtUtils.verifyJwtSignature.mockReturnValue({
      success: true,
      data: mockToken.payload,
    });

    mockJwtUtils.validateTokenTime.mockReturnValue({
      success: true,
      data: undefined,
    });

    mockKeyRetrieverInstance.getPublicKey.mockResolvedValue({
      success: true,
      data: 'mockedPublicKey',
    });

    // Mock old jwt directly for legacy tests that still use it
    const mockDecodeToken = jwt.decode as jest.Mock;
    mockVerifyToken = jwt.verify as jest.Mock;
    mockDecodeToken.mockImplementation(() => mockToken);
    mockVerifyToken.mockImplementation(() => mockToken);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('can create an EntraTokenValidator without options', () => {
      const entraTokenValidator = new EntraTokenValidator({
        clientId: mockClientId,
        tenantId: mockTenantId,
      });
      expect(MockedJwksKeyRetriever).toHaveBeenCalledTimes(1);
      expect(entraTokenValidator.clientId).toEqual(mockClientId);
      expect(entraTokenValidator.tenantId).toEqual(mockTenantId);
      expect(entraTokenValidator.validIssuerTenantIds).toEqual([mockTenantId]);
    });

    it.each`
      allowedTenantIds          | description
      ${undefined}              | ${'no allowed tenantIds'}
      ${[]}                     | ${'empty list of allowed tenantIds'}
      ${['tenant1', 'tenant2']} | ${'two allowed tenantIds'}
    `(
      'can create an EntraTokenValidator for a single tenant app with options.allowedTenantIds set to $description',
      ({ allowedTenantIds }) => {
        const entraTokenValidator = new EntraTokenValidator({
          clientId: mockClientId,
          tenantId: mockTenantId,
          options: { allowedTenantIds },
        });
        expect(MockedJwksKeyRetriever).toHaveBeenCalledTimes(1);
        expect(entraTokenValidator.clientId).toEqual(mockClientId);
        expect(entraTokenValidator.tenantId).toEqual(mockTenantId);
        expect(entraTokenValidator.validIssuerTenantIds).toEqual([mockTenantId]);
      }
    );

    it.each`
      tenantId           | allowedTenantIds          | validIssuerTenantIds      | description
      ${'common'}        | ${undefined}              | ${[]}                     | ${'no allowed tenantIds'}
      ${'common'}        | ${[]}                     | ${[]}                     | ${'empty list of allowed tenantIds'}
      ${'common'}        | ${['tenant1', 'tenant2']} | ${['tenant1', 'tenant2']} | ${'two allowed tenantIds'}
      ${'organizations'} | ${['tenant1', 'tenant2']} | ${['tenant1', 'tenant2']} | ${'two allowed tenantIds'}
      ${'consumers'}     | ${['tenant1', 'tenant2']} | ${['tenant1', 'tenant2']} | ${'two allowed tenantIds'}
    `(
      'can create an EntraTokenValidator for tenantId "$tenantId" with $description',
      ({ tenantId, allowedTenantIds, validIssuerTenantIds }) => {
        const entraTokenValidator = new EntraTokenValidator({
          clientId: mockClientId,
          tenantId,
          options: { allowedTenantIds },
        });
        expect(MockedJwksKeyRetriever).toHaveBeenCalledTimes(1);
        expect(entraTokenValidator.clientId).toEqual(mockClientId);
        expect(entraTokenValidator.tenantId).toEqual(tenantId);
        expect(entraTokenValidator.validIssuerTenantIds).toEqual(validIssuerTenantIds);
      }
    );
  });

  describe('getTokenPayload', () => {
    it('should return the token payload', () => {
      const entraTokenValidator = new EntraTokenValidator({
        clientId: mockClientId,
        tenantId: mockTenantId,
      });
      const tokenPayload = entraTokenValidator.getTokenPayload(mockToken);
      expect(tokenPayload).toEqual(mockToken.payload);
    });

    it('returns null when token payload is not an object', () => {
      const token = {
        ...mockToken,
        payload: 'not-an-object',
      };
      const entraTokenValidator = new EntraTokenValidator({
        clientId: mockClientId,
        tenantId: mockTenantId,
      });

      const tokenPayload = entraTokenValidator.getTokenPayload(token);
      expect(tokenPayload).toBeNull();
      expect(mockLogger.error).not.toHaveBeenCalled();
    });
  });

  describe('validateAccessToken', () => {
    it('should return null if no token is provided', async () => {
      mockJwtUtils.decodeJwt.mockReturnValue({
        success: false,
        error: 'No token provided',
      });

      const entraTokenValidator = new EntraTokenValidator({
        clientId: mockClientId,
        tenantId: mockTenantId,
      });
      const result = await entraTokenValidator.validateAccessToken(mockLogger, '');
      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledTimes(1);
      expect(mockLogger.error).toHaveBeenCalledWith('No token provided');
    });

    it('should catch and log exception if the token cannot be decoded', async () => {
      mockJwtUtils.decodeJwt.mockReturnValue({
        success: false,
        error: 'Token malformed: Invalid token exception',
      });

      const entraTokenValidator = new EntraTokenValidator({
        clientId: mockClientId,
        tenantId: mockTenantId,
      });

      const result = await entraTokenValidator.validateAccessToken(mockLogger, 'invalid-token');
      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledTimes(1);
      expect(mockLogger.error).toHaveBeenCalledWith('Token malformed: Invalid token exception');
    });

    it('should return null if public key can not be found', async () => {
      mockKeyRetrieverInstance.getPublicKey.mockResolvedValue({
        success: false,
        error: 'Failed to get signing key for kid mock-kid: Key not found',
      });

      const entraTokenValidator = new EntraTokenValidator({
        clientId: mockClientId,
        tenantId: mockTenantId,
      });
      const result = await entraTokenValidator.validateAccessToken(mockLogger, 'bearer-token');
      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledTimes(1);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to get signing key for kid mock-kid: Key not found'
      );
    });

    it('should return null if public key can not be fetched', async () => {
      mockKeyRetrieverInstance.getPublicKey.mockResolvedValue({
        success: false,
        error: 'Failed to get signing key for kid mock-kid: Public key fetch error',
      });

      const entraTokenValidator = new EntraTokenValidator({
        clientId: mockClientId,
        tenantId: mockTenantId,
      });

      const result = await entraTokenValidator.validateAccessToken(mockLogger, 'bearer-token');
      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledTimes(1);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to get signing key for kid mock-kid: Public key fetch error'
      );
    });

    it('should return null if token signature can not be verified', async () => {
      mockJwtUtils.verifyJwtSignature.mockReturnValue({
        success: false,
        error: 'JWT signature verification failed: Token signature verification error',
      });

      const entraTokenValidator = new EntraTokenValidator({
        clientId: mockClientId,
        tenantId: mockTenantId,
      });

      const result = await entraTokenValidator.validateAccessToken(mockLogger, 'bearer-token');
      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledTimes(1);
      expect(mockLogger.error).toHaveBeenCalledWith('JWT signature verification failed: Token signature verification error');
    });
  });

  describe('validateAccessTokenClaims', () => {
    it.each`
      tokenScp             | requiredScope        | description
      ${undefined}         | ${undefined}         | ${'no scope is present or required'}
      ${'access_as_user'}  | ${undefined}         | ${'no scope is required'}
      ${'access_as_santa'} | ${'access_as_santa'} | ${'the requested scope is present'}
    `('returns a token when $description', async ({ tokenScp, requiredScope }) => {
      const expectedPayload = { ...mockToken.payload, scp: tokenScp };
      const expectedToken = {
        ...mockToken,
        payload: expectedPayload,
      };

      // Mock the shared utility to return the expected payload
      mockJwtUtils.verifyJwtSignature.mockReturnValue({
        success: true,
        data: expectedPayload,
      });

      const entraTokenValidator = new EntraTokenValidator({
        clientId: mockClientId,
        tenantId: mockTenantId,
      });

      const result = await entraTokenValidator.validateAccessToken(
        mockLogger,
        'bearer-token',
        requiredScope
      );
      expect(result).toEqual(expectedToken);
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it.each`
      audience
      ${mockClientId}
      ${`api://${mockClientId}`}
    `('returns a token when audience is $audience', async ({ audience }) => {
      const expectedPayload = { ...mockToken.payload, aud: audience };
      const expectedToken = {
        ...mockToken,
        payload: expectedPayload,
      };

      // Mock the shared utility to return the expected payload
      mockJwtUtils.verifyJwtSignature.mockReturnValue({
        success: true,
        data: expectedPayload,
      });

      const entraTokenValidator = new EntraTokenValidator({
        clientId: mockClientId,
        tenantId: mockTenantId,
      });

      const result = await entraTokenValidator.validateAccessToken(mockLogger, 'bearer-token');
      expect(result).toEqual(expectedToken);
      expect(mockLogger.error).not.toHaveBeenCalled();
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
        const expectedToken = {
          ...mockToken,
          payload: expectedPayload,
        };

        // Mock the shared utility to return the expected payload
        mockJwtUtils.verifyJwtSignature.mockReturnValue({
          success: true,
          data: expectedPayload,
        });

        const entraTokenValidator = new EntraTokenValidator({
          clientId: mockClientId,
          tenantId,
          options: { allowedTenantIds },
        });

        const result = await entraTokenValidator.validateAccessToken(mockLogger, 'bearer-token');
        expect(result).toEqual(expectedToken);
        expect(mockLogger.error).not.toHaveBeenCalled();
      }
    );

    it('should return null if token payload is missing', async () => {
      const entraTokenValidator = new EntraTokenValidator({
        clientId: mockClientId,
        tenantId: mockTenantId,
      });

      // Mock the shared utility to return success but with undefined payload
      mockJwtUtils.verifyJwtSignature.mockReturnValue({
        success: true,
        data: undefined as any, // This simulates missing payload
      });

      const result = await entraTokenValidator.validateAccessToken(mockLogger, 'bearer-token');
      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledTimes(2);
      expect(mockLogger.error).toHaveBeenCalledWith('Invalid token payload.');
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to validate the access token claims');
    });

    it('should return null if token issued-at value is missing', async () => {
      const entraTokenValidator = new EntraTokenValidator({
        clientId: mockClientId,
        tenantId: mockTenantId,
      });

      // Mock the shared utility to return payload with missing iat
      const payloadWithoutIat = { ...mockToken.payload, iat: undefined };
      mockJwtUtils.verifyJwtSignature.mockReturnValue({
        success: true,
        data: payloadWithoutIat,
      });

      const result = await entraTokenValidator.validateAccessToken(mockLogger, 'bearer-token');
      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledTimes(2);
      expect(mockLogger.error).toHaveBeenCalledWith('The token is expired or not yet valid.');
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to validate the access token claims');
    });

    it('should return null if token issued-at value is in the future', async () => {
      const entraTokenValidator = new EntraTokenValidator({
        clientId: mockClientId,
        tenantId: mockTenantId,
      });

      // Mock the shared utility to return payload with future iat
      const payloadWithFutureIat = { ...mockToken.payload, iat: mockDate.getTime() / 1000 + 1 };
      mockJwtUtils.verifyJwtSignature.mockReturnValue({
        success: true,
        data: payloadWithFutureIat,
      });

      const result = await entraTokenValidator.validateAccessToken(mockLogger, 'bearer-token');
      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledTimes(2);
      expect(mockLogger.error).toHaveBeenCalledWith('The token is expired or not yet valid.');
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to validate the access token claims');
    });

    it('should return null if token expires-at value is missing', async () => {
      const entraTokenValidator = new EntraTokenValidator({
        clientId: mockClientId,
        tenantId: mockTenantId,
      });

      // Mock the shared utility to return payload with missing exp
      const payloadWithoutExp = { ...mockToken.payload, exp: undefined };
      mockJwtUtils.verifyJwtSignature.mockReturnValue({
        success: true,
        data: payloadWithoutExp,
      });

      const result = await entraTokenValidator.validateAccessToken(mockLogger, 'bearer-token');
      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledTimes(2);
      expect(mockLogger.error).toHaveBeenCalledWith('The token is expired or not yet valid.');
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to validate the access token claims');
    });

    it('should return null if token expires-at value is in the past', async () => {
      const entraTokenValidator = new EntraTokenValidator({
        clientId: mockClientId,
        tenantId: mockTenantId,
      });

      // Mock the shared utility to return payload with expired token
      const payloadWithExpiredToken = { ...mockToken.payload, exp: mockDate.getTime() / 1000 - 1 };
      mockJwtUtils.verifyJwtSignature.mockReturnValue({
        success: true,
        data: payloadWithExpiredToken,
      });

      const result = await entraTokenValidator.validateAccessToken(mockLogger, 'bearer-token');
      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledTimes(2);
      expect(mockLogger.error).toHaveBeenCalledWith('The token is expired or not yet valid.');
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to validate the access token claims');
    });

    it('should return null if audience is missing', async () => {
      const entraTokenValidator = new EntraTokenValidator({
        clientId: mockClientId,
        tenantId: mockTenantId,
      });

      // Mock the shared utility to return payload with missing audience
      const payloadWithoutAudience = { ...mockToken.payload, aud: undefined };
      mockJwtUtils.verifyJwtSignature.mockReturnValue({
        success: true,
        data: payloadWithoutAudience,
      });

      const result = await entraTokenValidator.validateAccessToken(mockLogger, 'bearer-token');
      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledTimes(2);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'The token is not issued for the expected audience.'
      );
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to validate the access token claims');
    });

    it('should return null if audience is unexpected', async () => {
      const entraTokenValidator = new EntraTokenValidator({
        clientId: mockClientId,
        tenantId: mockTenantId,
      });

      // Mock the shared utility to return payload with wrong audience
      const payloadWithWrongAudience = { ...mockToken.payload, aud: 'api://wrong-client-id' };
      mockJwtUtils.verifyJwtSignature.mockReturnValue({
        success: true,
        data: payloadWithWrongAudience,
      });

      const result = await entraTokenValidator.validateAccessToken(mockLogger, 'bearer-token');
      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledTimes(2);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'The token is not issued for the expected audience.'
      );
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to validate the access token claims');
    });

    it('should return null if issuer is missing', async () => {
      const entraTokenValidator = new EntraTokenValidator({
        clientId: mockClientId,
        tenantId: mockTenantId,
      });

      // Mock the shared utility to return payload with missing issuer
      const payloadWithoutIssuer = { ...mockToken.payload, iss: undefined };
      mockJwtUtils.verifyJwtSignature.mockReturnValue({
        success: true,
        data: payloadWithoutIssuer,
      });

      const result = await entraTokenValidator.validateAccessToken(mockLogger, 'bearer-token');
      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledTimes(2);
      expect(mockLogger.error).toHaveBeenCalledWith('Invalid token issuer.');
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to validate the access token claims');
    });

    it('should return null if issuer is unexpected', async () => {
      const entraTokenValidator = new EntraTokenValidator({
        clientId: mockClientId,
        tenantId: mockTenantId,
      });

      // Mock the shared utility to return payload with unexpected issuer
      const payloadWithUnexpectedIssuer = {
        ...mockToken.payload,
        iss: 'https://login.microsoftonline.com/some-other-tenant/v2.0',
      };
      mockJwtUtils.verifyJwtSignature.mockReturnValue({
        success: true,
        data: payloadWithUnexpectedIssuer,
      });

      const result = await entraTokenValidator.validateAccessToken(mockLogger, 'bearer-token');
      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledTimes(2);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'The token is issued by unexpected tenant: https://login.microsoftonline.com/some-other-tenant/v2.0'
      );
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to validate the access token claims');
    });

    it('should return null if token is issued for the wrong scope', async () => {
      const entraTokenValidator = new EntraTokenValidator({
        clientId: mockClientId,
        tenantId: mockTenantId,
      });

      const result = await entraTokenValidator.validateAccessToken(
        mockLogger,
        'bearer-token',
        'access_as_santa_claus'
      );
      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledTimes(2);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'The token is not issued for the required scope: access_as_santa_claus'
      );
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to validate the access token claims');
    });
  });
});
