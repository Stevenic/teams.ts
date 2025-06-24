import * as jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

import { Client } from '@microsoft/teams.common';

import { CacheManager } from './cache-manager';
import { JwksKeyRetriever } from './jwks-key-retriever';
import * as jwtUtils from './jwt-utils';
import { ServiceTokenValidator, TokenValidationError, TokenValidationErrorCode } from './service-token-validator';

jest.mock('jsonwebtoken', () => ({
  decode: jest.fn(),
  verify: jest.fn(),
}));
jest.mock('jwks-rsa');
jest.mock('@microsoft/teams.common', () => ({
  Client: jest.fn(),
}));
jest.mock('./jwt-utils', () => ({
  decodeJwt: jest.fn(),
  verifyJwtSignature: jest.fn(),
  validateTokenTime: jest.fn(),
  isSupportedAlgorithm: jest.fn(),
}));
jest.mock('./jwks-key-retriever');
jest.mock('./cache-manager');

// const mockJwt = jwt as jest.Mocked<typeof jwt>; // Not used after refactoring
const mockJwksClient = jwksClient as jest.MockedFunction<typeof jwksClient>;
const mockJwtUtils = jwtUtils as jest.Mocked<typeof jwtUtils>;
const MockedJwksKeyRetriever = JwksKeyRetriever as jest.MockedClass<typeof JwksKeyRetriever>;
const MockedCacheManager = CacheManager as jest.MockedClass<typeof CacheManager>;

const MockedClient = Client as jest.MockedClass<typeof Client>;

describe('ServiceTokenValidator', () => {
  let validator: ServiceTokenValidator;
  let mockJwksClientInstance: any;
  let mockClientInstance: any;
  let mockKeyRetrieverInstance: any;
  let mockCacheManagerInstance: any;
  let mockJsonwebtoken: jest.Mocked<typeof jwt>;

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

    mockJwksClientInstance = {
      getSigningKey: jest.fn(),
      verify: jest.fn(),
    };

    mockJwksClient.mockReturnValue(mockJwksClientInstance);

    mockClientInstance = {
      get: jest.fn(),
    };

    MockedClient.mockImplementation(() => mockClientInstance);

    // Mock shared utilities
    mockKeyRetrieverInstance = {
      getPublicKey: jest.fn(),
    };
    MockedJwksKeyRetriever.mockImplementation(() => mockKeyRetrieverInstance);

    mockCacheManagerInstance = {
      get: jest.fn(),
      set: jest.fn(),
      clear: jest.fn(),
      isExpired: jest.fn(),
    };
    MockedCacheManager.mockImplementation(() => mockCacheManagerInstance);

    // Setup default successful responses for shared utilities
    mockJwtUtils.decodeJwt.mockReturnValue({
      success: true,
      data: {
        header: VALID_HEADER,
        payload: VALID_PAYLOAD,
      },
    });

    mockJwtUtils.validateTokenTime.mockReturnValue({
      success: true,
      data: undefined,
    });

    mockJsonwebtoken = jwt as jest.Mocked<typeof jwt>;

    mockJsonwebtoken.verify.mockImplementation((token) => {
      if (token === 'valid.jwt.token') {
        return VALID_PAYLOAD;
      }
      throw new Error('Invalid token');
    });

    mockJwtUtils.isSupportedAlgorithm.mockReturnValue(true);

    mockKeyRetrieverInstance.getPublicKey.mockResolvedValue({
      success: true,
      data: TEST_PUBLIC_KEY,
    });

    mockCacheManagerInstance.get.mockReturnValue(null); // No cached metadata initially

    validator = new ServiceTokenValidator(TEST_APP_ID);
  });

  describe('validateToken', () => {
    beforeEach(() => {
      // Mock successful metadata fetch
      mockClientInstance.get.mockResolvedValue({
        data: VALID_METADATA,
      });
    });

    it('should successfully validate a valid token', async () => {
      await expect(validator.validateAccessToken('valid.jwt.token')).resolves.toBeUndefined();
    });

    it('should validate token with service URL', async () => {
      const serviceUrl = VALID_PAYLOAD.serviceurl!;
      await expect(validator.validateAccessToken('valid.jwt.token', serviceUrl)).resolves.toBeUndefined();
    });

    it.each([
      {
        name: 'missing token',
        token: '',
        setup: () => {
          mockJwtUtils.decodeJwt.mockReturnValue({
            success: false,
            error: 'No token provided',
          });
        },
        expectedError: TokenValidationError,
        expectedCode: TokenValidationErrorCode.MISSING_TOKEN,
      },
      {
        name: 'malformed token',
        token: 'invalid.token',
        setup: () => {
          mockJwtUtils.decodeJwt.mockReturnValue({
            success: false,
            error: 'Token malformed: Invalid token',
          });
        },
        expectedError: TokenValidationError,
        expectedCode: TokenValidationErrorCode.MISSING_TOKEN,
      },
      {
        name: 'missing algorithm',
        token: 'token.without.alg',
        setup: () => {
          mockJwtUtils.decodeJwt.mockReturnValue({
            success: true,
            data: {
              header: { ...VALID_HEADER, alg: undefined as any },
              payload: VALID_PAYLOAD,
            },
          });
        },
        expectedError: TokenValidationError,
        expectedCode: TokenValidationErrorCode.MALFORMED_TOKEN,
      },
      {
        name: 'unsupported algorithm',
        token: 'token.with.unsupported.alg',
        setup: () => {
          mockJwtUtils.decodeJwt.mockReturnValue({
            success: true,
            data: {
              header: { ...VALID_HEADER, alg: 'UNSUPPORTED_ALG' },
              payload: VALID_PAYLOAD,
            },
          });
          mockJwtUtils.isSupportedAlgorithm.mockReturnValue(false);
        },
        expectedError: TokenValidationError,
        expectedCode: TokenValidationErrorCode.UNSUPPORTED_ALGORITHM,
      },
    ])('should throw TokenValidationError for $name', async ({ token, setup, expectedError, expectedCode }) => {
      setup();

      await expect(validator.validateAccessToken(token)).rejects.toThrow(expectedError);
      await expect(validator.validateAccessToken(token)).rejects.toMatchObject({
        code: expectedCode,
      });
    });

    it('should throw TokenValidationError when metadata fetch fails', async () => {
      // Create a new validator instance to avoid cached metadata
      const freshValidator = new ServiceTokenValidator(TEST_APP_ID);

      // Reset all mocks to clear any previous setup
      mockClientInstance.get.mockReset();

      mockClientInstance.get.mockRejectedValue(new Error('Network error'));

      await expect(freshValidator.validateAccessToken('valid.jwt.token')).rejects.toThrow(TokenValidationError);
      await expect(freshValidator.validateAccessToken('valid.jwt.token')).rejects.toMatchObject({
        code: TokenValidationErrorCode.METADATA_RETRIEVAL_FAILED,
      });
    });

    it('should throw TokenValidationError for unsupported algorithm in metadata', async () => {
      // Create a fresh validator to ensure we get fresh metadata
      const freshValidator = new ServiceTokenValidator(TEST_APP_ID);

      const metadataWithLimitedAlgs = {
        ...VALID_METADATA,
        id_token_signing_alg_values_supported: ['ES256'],
      };

      // Reset the mock to clear any cached calls
      mockClientInstance.get.mockReset();
      mockClientInstance.get.mockResolvedValue({
        data: metadataWithLimitedAlgs,
      });

      await expect(freshValidator.validateAccessToken('valid.jwt.token')).rejects.toThrow(TokenValidationError);
      await expect(freshValidator.validateAccessToken('valid.jwt.token')).rejects.toMatchObject({
        code: TokenValidationErrorCode.UNSUPPORTED_ALGORITHM,
      });
    });

    it('should throw TokenValidationError for missing key ID', async () => {
      jest.clearAllMocks();

      mockJwtUtils.decodeJwt.mockReturnValue({
        success: true,
        data: {
          header: { ...VALID_HEADER, kid: undefined as any },
          payload: VALID_PAYLOAD,
        },
      });

      mockClientInstance.get.mockResolvedValue({
        data: VALID_METADATA,
      });

      await expect(validator.validateAccessToken('token.without.kid')).rejects.toThrow(TokenValidationError);
      await expect(validator.validateAccessToken('token.without.kid')).rejects.toMatchObject({
        code: TokenValidationErrorCode.MISSING_KEY_ID,
      });
    });

    it('should throw TokenValidationError when key retrieval fails', async () => {
      mockKeyRetrieverInstance.getPublicKey.mockResolvedValue({
        success: false,
        error: 'Failed to get signing key for kid test-key-id: Key not found',
      });

      await expect(validator.validateAccessToken('valid.jwt.token')).rejects.toThrow(TokenValidationError);
      await expect(validator.validateAccessToken('valid.jwt.token')).rejects.toMatchObject({
        code: TokenValidationErrorCode.KEY_NOT_FOUND,
      });
    });

    it('should throw TokenValidationError when JWT verification fails', async () => {
      mockJsonwebtoken.verify.mockImplementation(() =>
        'JWT signature verification failed: Invalid signature',
      );

      await expect(validator.validateAccessToken('valid.jwt.token')).rejects.toThrow(TokenValidationError);
      await expect(validator.validateAccessToken('valid.jwt.token')).rejects.toMatchObject({
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

      // Reset shared utility mocks to defaults
      mockJwtUtils.validateTokenTime.mockReturnValue({ success: true, data: undefined });
      mockJsonwebtoken.verify.mockImplementation(() => VALID_PAYLOAD);
      mockJwtUtils.isSupportedAlgorithm.mockReturnValue(true);
      mockKeyRetrieverInstance.getPublicKey.mockResolvedValue({ success: true, data: TEST_PUBLIC_KEY });
    });

    it.each([
      {
        name: 'invalid issuer',
        token: 'token.with.invalid.issuer',
        payload: { ...VALID_PAYLOAD, iss: 'https://invalid.issuer.com' },
        expectedError: TokenValidationError,
        expectedCode: TokenValidationErrorCode.INVALID_ISSUER,
      },
      {
        name: 'invalid audience',
        token: 'token.with.invalid.audience',
        payload: { ...VALID_PAYLOAD, aud: 'wrong-app-id' },
        expectedError: TokenValidationError,
        expectedCode: TokenValidationErrorCode.INVALID_AUDIENCE,
      },
      {
        name: 'missing expiration',
        token: 'token.without.exp',
        payload: { ...VALID_PAYLOAD, exp: undefined },
        expectedError: TokenValidationError,
        expectedCode: TokenValidationErrorCode.MALFORMED_TOKEN,
      },
      {
        name: 'expired token',
        token: 'expired.token',
        payload: { ...VALID_PAYLOAD, exp: Math.floor(Date.now() / 1000) - 3600 },
        expectedError: TokenValidationError,
        expectedCode: TokenValidationErrorCode.EXPIRED_TOKEN,
      },
      {
        name: 'future token',
        token: 'future.token',
        payload: { ...VALID_PAYLOAD, iat: Math.floor(Date.now() / 1000) + 3600 },
        expectedError: TokenValidationError,
        expectedCode: TokenValidationErrorCode.FUTURE_TOKEN,
      },
    ])('should throw TokenValidationError for $name', async ({ token, payload, expectedError, expectedCode }) => {
      // Mock the decode to return the test payload
      mockJwtUtils.decodeJwt.mockReturnValue({
        success: true,
        data: {
          header: VALID_HEADER,
          payload,
        },
      });

      // For time validation errors, also mock the time validation utility
      if (expectedCode === TokenValidationErrorCode.EXPIRED_TOKEN) {
        mockJwtUtils.validateTokenTime.mockReturnValue({
          success: false,
          error: 'Token is expired',
        });
      } else if (expectedCode === TokenValidationErrorCode.FUTURE_TOKEN) {
        mockJwtUtils.validateTokenTime.mockReturnValue({
          success: false,
          error: 'Token issued in the future',
        });
      } else if (expectedCode === TokenValidationErrorCode.MALFORMED_TOKEN && payload.exp === undefined) {
        mockJwtUtils.validateTokenTime.mockReturnValue({
          success: false,
          error: 'Token missing expiration claim',
        });
      }

      await expect(validator.validateAccessToken(token)).rejects.toThrow(expectedError);
      await expect(validator.validateAccessToken(token)).rejects.toMatchObject({
        code: expectedCode,
      });
    });
  });

  describe('validateServiceUrl', () => {
    beforeEach(() => {
      jest.clearAllMocks();

      // Setup successful token validation
      mockJwtUtils.decodeJwt.mockReturnValue({
        success: true,
        data: {
          header: VALID_HEADER,
          payload: VALID_PAYLOAD,
        },
      });

      mockClientInstance.get.mockResolvedValue({
        data: VALID_METADATA,
      });

      mockJwtUtils.validateTokenTime.mockReturnValue({ success: true, data: undefined });
      mockJsonwebtoken.verify.mockImplementation(() => VALID_PAYLOAD);
      mockJwtUtils.isSupportedAlgorithm.mockReturnValue(true);
      mockKeyRetrieverInstance.getPublicKey.mockResolvedValue({ success: true, data: TEST_PUBLIC_KEY });
    });

    it.each([
      {
        name: 'missing service URL in token',
        token: 'token.without.serviceurl',
        serviceUrl: 'https://expected.service.url/',
        setup: () => {
          const payloadWithoutServiceUrl = { ...VALID_PAYLOAD, serviceurl: undefined };
          mockJsonwebtoken.verify.mockImplementation(() => payloadWithoutServiceUrl);
        },
        expectedCode: TokenValidationErrorCode.MISSING_SERVICE_URL,
      },
      {
        name: 'mismatched service URL',
        token: 'valid.jwt.token',
        serviceUrl: 'https://different.service.url/',
        setup: () => { },
        expectedCode: TokenValidationErrorCode.SERVICE_URL_MISMATCH,
      },
    ])('should throw TokenValidationError for $name', async ({ token, serviceUrl, setup, expectedCode }) => {
      setup();

      await expect(validator.validateAccessToken(token, serviceUrl)).rejects.toThrow(TokenValidationError);
      await expect(validator.validateAccessToken(token, serviceUrl)).rejects.toMatchObject({
        code: expectedCode,
      });
    });

    it('should normalize service URLs by removing trailing slashes', async () => {
      // Should pass when both URLs are normalized to the same value
      await expect(validator.validateAccessToken(
        'valid.jwt.token',
        'https://smba.trafficmanager.net/amer' // No trailing slash
      )).resolves.toBeUndefined();
    });
  });

  describe('JWKS client caching', () => {
    beforeEach(() => {
      jest.clearAllMocks();

      mockJwtUtils.decodeJwt.mockReturnValue({
        success: true,
        data: {
          header: VALID_HEADER,
          payload: VALID_PAYLOAD,
        },
      });

      mockClientInstance.get.mockResolvedValue({
        data: VALID_METADATA,
      });

      mockJwtUtils.validateTokenTime.mockReturnValue({ success: true, data: undefined });
      mockJsonwebtoken.verify.mockImplementation(() => VALID_PAYLOAD);
      mockJwtUtils.isSupportedAlgorithm.mockReturnValue(true);
      mockKeyRetrieverInstance.getPublicKey.mockResolvedValue({ success: true, data: TEST_PUBLIC_KEY });
    });

    it('should reuse JWKS client for same URI', async () => {
      await validator.validateAccessToken('token1');
      await validator.validateAccessToken('token2');

      // Check that key retriever was called for both tokens but with same URI
      expect(mockKeyRetrieverInstance.getPublicKey).toHaveBeenCalledTimes(2);
      expect(mockKeyRetrieverInstance.getPublicKey).toHaveBeenCalledWith(TEST_KID, TEST_JWKS_URI);
    });

    it('should create new JWKS client when URI changes', async () => {
      // First validation
      await validator.validateAccessToken('token1');

      // Create a new validator instance to test URI change scenario
      const newValidator = new ServiceTokenValidator(TEST_APP_ID);

      // Mock different metadata with different JWKS URI for the new call
      const differentMetadata = {
        ...VALID_METADATA,
        jwks_uri: 'https://different.jwks.uri/',
      };

      mockClientInstance.get.mockResolvedValueOnce({
        data: differentMetadata,
      });

      // Second validation with different URI using new validator
      await newValidator.validateAccessToken('token2');

      // Verify that both validators got their respective JWKS URIs
      expect(mockKeyRetrieverInstance.getPublicKey).toHaveBeenCalledWith(TEST_KID, TEST_JWKS_URI);
      expect(mockKeyRetrieverInstance.getPublicKey).toHaveBeenCalledWith(TEST_KID, 'https://different.jwks.uri/');
    });
  });

  describe('metadata caching', () => {
    beforeEach(() => {
      jest.clearAllMocks();

      mockJwtUtils.decodeJwt.mockReturnValue({
        success: true,
        data: {
          header: VALID_HEADER,
          payload: VALID_PAYLOAD,
        },
      });

      mockJwtUtils.validateTokenTime.mockReturnValue({ success: true, data: undefined });
      mockJsonwebtoken.verify.mockImplementation(() => VALID_PAYLOAD);
      mockJwtUtils.isSupportedAlgorithm.mockReturnValue(true);
      mockKeyRetrieverInstance.getPublicKey.mockResolvedValue({ success: true, data: TEST_PUBLIC_KEY });
    });

    it('should cache metadata and reuse it', async () => {
      // Reset to ensure clean state
      mockClientInstance.get.mockReset();

      // Set up cache to return null first time (cache miss), then return cached data
      let firstCall = true;
      mockCacheManagerInstance.get.mockImplementation(() => {
        if (firstCall) {
          firstCall = false;
          return null; // Cache miss
        }
        return VALID_METADATA; // Cache hit
      });

      mockClientInstance.get.mockResolvedValue({
        data: VALID_METADATA,
      });

      await validator.validateAccessToken('token1');
      await validator.validateAccessToken('token2');

      // Should only fetch metadata once due to caching
      expect(mockClientInstance.get).toHaveBeenCalledTimes(1);
    });

    it('should refetch metadata after cache expiry', async () => {
      mockClientInstance.get.mockResolvedValue({
        data: VALID_METADATA,
      });

      // First validation - metadata should be fetched
      await validator.validateAccessToken('token1');
      expect(mockClientInstance.get).toHaveBeenCalledTimes(1);

      // Mock time to simulate cache expiry
      const originalDateNow = Date.now;
      Date.now = jest.fn().mockReturnValue(Date.now() + 3600001); // After cache TTL

      // Second validation - metadata should be refetched due to expiry
      await validator.validateAccessToken('token2');

      Date.now = originalDateNow;

      expect(mockClientInstance.get).toHaveBeenCalledTimes(2);
    });
  });
});