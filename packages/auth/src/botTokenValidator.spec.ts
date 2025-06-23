import * as jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

import { Client } from '@microsoft/teams.common';

import { BotTokenValidator } from './botTokenValidator';
import {
  TokenAuthenticationError,
  TokenClaimsError,
  TokenFormatError,
  TokenInfrastructureError,
  TokenValidationErrorCode
} from './types';

// Mock dependencies
jest.mock('jsonwebtoken', () => ({
  decode: jest.fn(),
  verify: jest.fn(),
}));
jest.mock('jwks-rsa');
jest.mock('@microsoft/teams.common', () => ({
  Client: jest.fn(),
  ILogger: {},
}));

const mockJwt = jwt as jest.Mocked<typeof jwt>;
const mockJwksClient = jwksClient as jest.MockedFunction<typeof jwksClient>;

const MockedClient = Client as jest.MockedClass<typeof Client>;

describe('BotTokenValidator', () => {
  let validator: BotTokenValidator;
  let mockLogger: any;
  let mockJwksClientInstance: any;
  let mockClientInstance: any;

  const TEST_APP_ID = 'test-app-id';
  const TEST_KID = 'test-key-id';
  const TEST_JWKS_URI = 'https://login.botframework.com/.well-known/jwks';
  const TEST_PUBLIC_KEY = '-----BEGIN RSA PUBLIC KEY-----\ntest-key\n-----END RSA PUBLIC KEY-----';

  const VALID_METADATA = {
    issuer: 'https://api.botframework.com',
    jwks_uri: TEST_JWKS_URI,
    id_token_signing_alg_values_supported: ['RS256', 'RS384', 'RS512'],
    authorization_endpoint: 'https://login.botframework.com/authorize',
    token_endpoint_auth_methods_supported: ['client_secret_post'],
  };

  const VALID_HEADER = {
    alg: 'RS256',
    typ: 'JWT',
    kid: TEST_KID,
  };

  const VALID_PAYLOAD: jwt.JwtPayload = {
    iss: 'https://api.botframework.com',
    aud: TEST_APP_ID,
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    serviceurl: 'https://smba.trafficmanager.net/amer/',
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockLogger = {
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
    };

    mockJwksClientInstance = {
      getSigningKey: jest.fn(),
      verify: jest.fn(),
    };

    mockJwksClient.mockReturnValue(mockJwksClientInstance);

    mockClientInstance = {
      get: jest.fn(),
    };

    MockedClient.mockImplementation(() => mockClientInstance);

    validator = new BotTokenValidator(TEST_APP_ID, mockLogger);
  });

  describe('validateToken', () => {
    beforeEach(() => {
      // Mock successful decode
      mockJwt.decode.mockImplementation((_token, options) => {
        if (options && typeof options === 'object' && 'complete' in options && options.complete) {
          return {
            header: VALID_HEADER,
            payload: VALID_PAYLOAD,
          };
        }
        return VALID_PAYLOAD;
      });

      // Mock successful metadata fetch
      mockClientInstance.get.mockResolvedValue({
        data: VALID_METADATA,
      });

      // Mock successful JWKS key retrieval
      mockJwksClientInstance.getSigningKey.mockResolvedValue({
        getPublicKey: () => TEST_PUBLIC_KEY,
      });

      // Mock successful token verification with proper typing
      mockJwt.verify.mockImplementation(() => {
        return VALID_PAYLOAD;
      });
    });

    it('should successfully validate a valid token', async () => {
      const result = await validator.validateToken('valid.jwt.token');

      expect(result).toEqual(VALID_PAYLOAD);
      expect(mockLogger.debug).toHaveBeenCalledWith('Bot Framework token validation successful');
    });

    it('should validate token with service URL', async () => {
      const serviceUrl = 'https://smba.trafficmanager.net/amer/';
      const result = await validator.validateToken('valid.jwt.token', serviceUrl);

      expect(result).toEqual(VALID_PAYLOAD);
    });

    it.each([
      {
        name: 'missing token',
        token: '',
        setup: () => { },
        expectedError: TokenFormatError,
        expectedCode: TokenValidationErrorCode.MISSING_TOKEN,
      },
      {
        name: 'malformed token',
        token: 'invalid.token',
        setup: () => {
          mockJwt.decode.mockImplementation(() => {
            throw new Error('Invalid token');
          });
        },
        expectedError: TokenFormatError,
        expectedCode: TokenValidationErrorCode.MALFORMED_TOKEN,
      },
      {
        name: 'missing algorithm',
        token: 'token.without.alg',
        setup: () => {
          mockJwt.decode
            .mockReturnValueOnce({
              header: { ...VALID_HEADER, alg: undefined },
              payload: VALID_PAYLOAD,
            })
            .mockReturnValueOnce(VALID_PAYLOAD);
        },
        expectedError: TokenFormatError,
        expectedCode: TokenValidationErrorCode.MALFORMED_TOKEN,
      },
      {
        name: 'unsupported algorithm',
        token: 'token.with.unsupported.alg',
        setup: () => {
          mockJwt.decode.mockImplementation((_token, options) => {
            if (options && typeof options === 'object' && 'complete' in options && options.complete) {
              return {
                header: { ...VALID_HEADER, alg: 'UNSUPPORTED_ALG' },
                payload: VALID_PAYLOAD,
              };
            }
            return VALID_PAYLOAD;
          });
        },
        expectedError: TokenFormatError,
        expectedCode: TokenValidationErrorCode.UNSUPPORTED_ALGORITHM,
      },
    ])('should throw TokenFormatError for $name', async ({ token, setup, expectedError, expectedCode }) => {
      setup();

      await expect(validator.validateToken(token)).rejects.toThrow(expectedError);
      await expect(validator.validateToken(token)).rejects.toMatchObject({
        code: expectedCode,
      });
    });

    it('should throw TokenInfrastructureError when metadata fetch fails', async () => {
      // Create a new validator instance to avoid cached metadata
      const freshValidator = new BotTokenValidator(TEST_APP_ID, mockLogger);

      // Reset all mocks to clear any previous setup
      mockClientInstance.get.mockReset();
      mockJwt.decode.mockReset();

      mockJwt.decode.mockImplementation((_token, options) => {
        if (options && typeof options === 'object' && 'complete' in options && options.complete) {
          return {
            header: VALID_HEADER,
            payload: VALID_PAYLOAD,
          };
        }
        return VALID_PAYLOAD;
      });

      mockClientInstance.get.mockRejectedValue(new Error('Network error'));

      await expect(freshValidator.validateToken('valid.jwt.token')).rejects.toThrow(TokenInfrastructureError);
      await expect(freshValidator.validateToken('valid.jwt.token')).rejects.toMatchObject({
        code: TokenValidationErrorCode.METADATA_RETRIEVAL_FAILED,
      });
    });

    it('should throw TokenAuthenticationError for unsupported algorithm in metadata', async () => {
      const metadataWithLimitedAlgs = {
        ...VALID_METADATA,
        id_token_signing_alg_values_supported: ['ES256'],
      };

      mockClientInstance.get.mockResolvedValueOnce({
        data: metadataWithLimitedAlgs,
      });

      await expect(validator.validateToken('valid.jwt.token')).rejects.toThrow(TokenAuthenticationError);
      await expect(validator.validateToken('valid.jwt.token')).rejects.toMatchObject({
        code: TokenValidationErrorCode.UNSUPPORTED_ALGORITHM,
      });
    });

    it('should throw TokenFormatError for missing key ID', async () => {
      jest.clearAllMocks();

      mockJwt.decode.mockImplementation((_token, options) => {
        if (options && typeof options === 'object' && 'complete' in options && options.complete) {
          return {
            header: { ...VALID_HEADER, kid: undefined },
            payload: VALID_PAYLOAD,
          };
        }
        return VALID_PAYLOAD;
      });

      mockClientInstance.get.mockResolvedValue({
        data: VALID_METADATA,
      });

      await expect(validator.validateToken('token.without.kid')).rejects.toThrow(TokenFormatError);
      await expect(validator.validateToken('token.without.kid')).rejects.toMatchObject({
        code: TokenValidationErrorCode.MISSING_KEY_ID,
      });
    });

    it('should throw TokenAuthenticationError when key retrieval fails', async () => {
      mockJwksClientInstance.getSigningKey.mockRejectedValue(new Error('Key not found'));

      await expect(validator.validateToken('valid.jwt.token')).rejects.toThrow(TokenAuthenticationError);
      await expect(validator.validateToken('valid.jwt.token')).rejects.toMatchObject({
        code: TokenValidationErrorCode.KEY_NOT_FOUND,
      });
    });

    it('should throw TokenAuthenticationError when JWT verification fails', async () => {
      mockJwt.verify.mockImplementation(() => {
        throw new Error('Invalid signature');
      });

      await expect(validator.validateToken('valid.jwt.token')).rejects.toThrow(TokenAuthenticationError);
      await expect(validator.validateToken('valid.jwt.token')).rejects.toMatchObject({
        code: TokenValidationErrorCode.SIGNATURE_VERIFICATION_FAILED,
      });
    });
  });

  describe('validateBasicClaims', () => {
    beforeEach(() => {
      // Reset mocks for this test suite
      jest.clearAllMocks();

      // Mock successful metadata fetch for these tests
      mockClientInstance.get.mockResolvedValue({
        data: VALID_METADATA,
      });

      mockJwksClientInstance.getSigningKey.mockResolvedValue({
        getPublicKey: () => TEST_PUBLIC_KEY,
      });
    });

    it.each([
      {
        name: 'invalid issuer',
        token: 'token.with.invalid.issuer',
        payload: { ...VALID_PAYLOAD, iss: 'https://invalid.issuer.com' },
        expectedError: TokenClaimsError,
        expectedCode: TokenValidationErrorCode.INVALID_ISSUER,
      },
      {
        name: 'invalid audience',
        token: 'token.with.invalid.audience',
        payload: { ...VALID_PAYLOAD, aud: 'wrong-app-id' },
        expectedError: TokenClaimsError,
        expectedCode: TokenValidationErrorCode.INVALID_AUDIENCE,
      },
      {
        name: 'missing expiration',
        token: 'token.without.exp',
        payload: { ...VALID_PAYLOAD, exp: undefined },
        expectedError: TokenFormatError,
        expectedCode: TokenValidationErrorCode.MALFORMED_TOKEN,
      },
      {
        name: 'expired token',
        token: 'expired.token',
        payload: { ...VALID_PAYLOAD, exp: Math.floor(Date.now() / 1000) - 3600 },
        expectedError: TokenClaimsError,
        expectedCode: TokenValidationErrorCode.EXPIRED_TOKEN,
      },
      {
        name: 'future token',
        token: 'future.token',
        payload: { ...VALID_PAYLOAD, iat: Math.floor(Date.now() / 1000) + 3600 },
        expectedError: TokenClaimsError,
        expectedCode: TokenValidationErrorCode.FUTURE_TOKEN,
      },
    ])('should throw $expectedError.name for $name', async ({ token, payload, expectedError, expectedCode }) => {
      mockJwt.decode.mockImplementation((_token, options) => {
        if (options && typeof options === 'object' && 'complete' in options && options.complete) {
          return {
            header: VALID_HEADER,
            payload,
          };
        }
        return payload;
      });

      await expect(validator.validateToken(token)).rejects.toThrow(expectedError);
      await expect(validator.validateToken(token)).rejects.toMatchObject({
        code: expectedCode,
      });
    });
  });

  describe('validateServiceUrl', () => {
    beforeEach(() => {
      jest.clearAllMocks();

      // Setup successful token validation
      mockJwt.decode.mockImplementation((_token, options) => {
        if (options && typeof options === 'object' && 'complete' in options && options.complete) {
          return {
            header: VALID_HEADER,
            payload: VALID_PAYLOAD,
          };
        }
        return VALID_PAYLOAD;
      });

      mockClientInstance.get.mockResolvedValue({
        data: VALID_METADATA,
      });

      mockJwksClientInstance.getSigningKey.mockResolvedValue({
        getPublicKey: () => TEST_PUBLIC_KEY,
      });

      mockJwt.verify.mockImplementation(() => {
        return VALID_PAYLOAD;
      });
    });

    it.each([
      {
        name: 'missing service URL in token',
        token: 'token.without.serviceurl',
        serviceUrl: 'https://expected.service.url/',
        setup: () => {
          const payloadWithoutServiceUrl = { ...VALID_PAYLOAD, serviceurl: undefined };
          mockJwt.verify.mockImplementation(() => {
            return payloadWithoutServiceUrl as jwt.JwtPayload;
          });
        },
        expectedCode: TokenValidationErrorCode.MISSING_SERVICE_URL,
      },
      {
        name: 'mismatched service URL',
        token: 'valid.jwt.token',
        serviceUrl: 'https://different.service.url/',
        setup: () => {},
        expectedCode: TokenValidationErrorCode.SERVICE_URL_MISMATCH,
      },
    ])('should throw TokenClaimsError for $name', async ({ token, serviceUrl, setup, expectedCode }) => {
      setup();

      await expect(validator.validateToken(token, serviceUrl)).rejects.toThrow(TokenClaimsError);
      await expect(validator.validateToken(token, serviceUrl)).rejects.toMatchObject({
        code: expectedCode,
      });
    });

    it('should normalize service URLs by removing trailing slashes', async () => {
      // Should pass when both URLs are normalized to the same value
      const result = await validator.validateToken(
        'valid.jwt.token',
        'https://smba.trafficmanager.net/amer' // No trailing slash
      );

      expect(result).toEqual(VALID_PAYLOAD);
    });
  });

  describe('JWKS client caching', () => {
    beforeEach(() => {
      jest.clearAllMocks();

      mockJwt.decode.mockImplementation((_token, options) => {
        if (options && typeof options === 'object' && 'complete' in options && options.complete) {
          return {
            header: VALID_HEADER,
            payload: VALID_PAYLOAD,
          };
        }
        return VALID_PAYLOAD;
      });

      mockClientInstance.get.mockResolvedValue({
        data: VALID_METADATA,
      });

      mockJwksClientInstance.getSigningKey.mockResolvedValue({
        getPublicKey: () => TEST_PUBLIC_KEY,
      });

      mockJwt.verify.mockImplementation(() => {
        return VALID_PAYLOAD;
      });
    });

    it('should reuse JWKS client for same URI', async () => {
      await validator.validateToken('token1');
      await validator.validateToken('token2');

      expect(mockJwksClient).toHaveBeenCalledTimes(1);
    });

    it('should create new JWKS client when URI changes', async () => {
      // First validation
      await validator.validateToken('token1');

      // Create a new validator instance to test URI change scenario
      const newValidator = new BotTokenValidator(TEST_APP_ID, mockLogger);

      // Mock different metadata with different JWKS URI for the new call
      const differentMetadata = {
        ...VALID_METADATA,
        jwks_uri: 'https://different.jwks.uri/',
      };

      mockClientInstance.get.mockResolvedValueOnce({
        data: differentMetadata,
      });

      // Second validation with different URI using new validator
      await newValidator.validateToken('token2');

      expect(mockJwksClient).toHaveBeenCalledTimes(2);
      expect(mockJwksClient).toHaveBeenNthCalledWith(1, {
        cache: true,
        cacheMaxAge: 3600000,
        jwksUri: TEST_JWKS_URI,
      });
      expect(mockJwksClient).toHaveBeenNthCalledWith(2, {
        cache: true,
        cacheMaxAge: 3600000,
        jwksUri: 'https://different.jwks.uri/',
      });
    });
  });

  describe('metadata caching', () => {
    beforeEach(() => {
      jest.clearAllMocks();

      mockJwt.decode.mockImplementation((_token, options) => {
        if (options && typeof options === 'object' && 'complete' in options && options.complete) {
          return {
            header: VALID_HEADER,
            payload: VALID_PAYLOAD,
          };
        }
        return VALID_PAYLOAD;
      });

      mockJwksClientInstance.getSigningKey.mockResolvedValue({
        getPublicKey: () => TEST_PUBLIC_KEY,
      });

      mockJwt.verify.mockImplementation(() => {
        return VALID_PAYLOAD;
      });
    });

    it('should cache metadata and reuse it', async () => {
      mockClientInstance.get.mockResolvedValue({
        data: VALID_METADATA,
      });

      await validator.validateToken('token1');
      await validator.validateToken('token2');

      // Should only fetch metadata once
      expect(mockClientInstance.get).toHaveBeenCalledTimes(1);
    });

    it('should refetch metadata after cache expiry', async () => {
      mockClientInstance.get.mockResolvedValue({
        data: VALID_METADATA,
      });

      // First validation - metadata should be fetched
      await validator.validateToken('token1');
      expect(mockClientInstance.get).toHaveBeenCalledTimes(1);

      // Mock time to simulate cache expiry
      const originalDateNow = Date.now;
      Date.now = jest.fn().mockReturnValue(Date.now() + 3600001); // After cache TTL

      // Second validation - metadata should be refetched due to expiry
      await validator.validateToken('token2');

      Date.now = originalDateNow;

      expect(mockClientInstance.get).toHaveBeenCalledTimes(2);
    });
  });
});