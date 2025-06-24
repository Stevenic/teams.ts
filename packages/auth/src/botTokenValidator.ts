import {
  Algorithm,
  decode,
  JwtHeader,
  verify,
} from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

import { Client, ILogger } from '@microsoft/teams.common';

import {
  IBotFrameworkJwtPayload,
  IOpenIdMetadata,
  TokenValidationError,
  TokenValidationErrorCode,
} from './types';

const CACHE_TTL = 3600000; // 1 hour in milliseconds
const OPEN_ID_CONFIG_URL = 'https://login.botframework.com/v1/.well-known/openidconfiguration';
const EXPECTED_ISSUER = 'https://api.botframework.com';
const EXPIRATION_BUFFER_SECONDS = 300; // 5 minutes buffer for expiration check

// https://github.com/auth0/node-jsonwebtoken#algorithms-supported
function isSupportedAlgorithm(value: string): value is Algorithm {
  const supportedAlgorithms: readonly string[] = [
    'HS256', 'HS384', 'HS512',
    'RS256', 'RS384', 'RS512',
    'ES256', 'ES384', 'ES512',
    'PS256', 'PS384', 'PS512',
    'none'
  ];
  return supportedAlgorithms.includes(value);
}

interface ICacheEntry<T> {
  data: T;
  expiry: number;
}

export class BotTokenValidator {
  private readonly appId: string;
  private readonly logger?: ILogger;
  private readonly client: Client = new Client();
  private metadataCache?: ICacheEntry<IOpenIdMetadata>;
  private jwksClient?: jwksClient.JwksClient;
  private currentJwksUri?: string;

  constructor(appId: string, logger?: ILogger) {
    this.appId = appId;
    this.logger = logger;
  }

  async validateToken(rawToken: string, serviceUrl?: string): Promise<IBotFrameworkJwtPayload> {
    if (!rawToken) {
      this.logger?.error('No token provided');
      throw new TokenValidationError(TokenValidationErrorCode.MISSING_TOKEN, 'No token provided');
    }

    let unverifiedHeader: JwtHeader;
    let unverifiedPayload: IBotFrameworkJwtPayload;

    try {
      const decodedComplete = decode(rawToken, { complete: true });
      if (!decodedComplete || typeof decodedComplete === 'string') {
        throw new Error('Failed to decode token - invalid format');
      }

      unverifiedHeader = decodedComplete.header;
      const payload = decodedComplete.payload;

      if (!unverifiedHeader || !payload || typeof payload !== 'object') {
        throw new Error('Failed to decode token');
      }

      unverifiedPayload = payload;
    } catch (error) {
      this.logger?.error(`Token malformed: ${error}`);
      throw new TokenValidationError(TokenValidationErrorCode.MALFORMED_TOKEN, 'Token malformed');
    }

    this.validateBasicClaims(unverifiedPayload);

    const algorithm = unverifiedHeader.alg;
    if (!algorithm) {
      this.logger?.error('Token missing algorithm in header');
      throw new TokenValidationError(TokenValidationErrorCode.MALFORMED_TOKEN, 'Token missing algorithm in header');
    }

    if (!isSupportedAlgorithm(algorithm)) {
      this.logger?.error(`Unsupported algorithm: ${algorithm}`);
      throw new TokenValidationError(TokenValidationErrorCode.UNSUPPORTED_ALGORITHM, `Unsupported algorithm: ${algorithm}`);
    }

    const metadata = await this.getOpenIdMetadata();
    if (!metadata) {
      this.logger?.error('Failed to retrieve OpenID metadata for algorithm validation');
      throw new TokenValidationError(
        TokenValidationErrorCode.METADATA_RETRIEVAL_FAILED,
        'Failed to retrieve OpenID metadata'
      );
    }

    // Initialize JWKS client once we have metadata
    const jwksClient = this.getJwksClient(metadata);
    if (!jwksClient) {
      this.logger?.error('Failed to initialize JWKS client');
      throw new TokenValidationError(
        TokenValidationErrorCode.JWKS_RETRIEVAL_FAILED,
        'Failed to initialize JWKS client'
      );
    }

    const supportedAlgorithms = metadata.id_token_signing_alg_values_supported;
    if (!supportedAlgorithms.includes(algorithm)) {
      this.logger?.error(`Token algorithm '${algorithm}' not in supported algorithms: ${supportedAlgorithms}`);
      throw new TokenValidationError(
        TokenValidationErrorCode.UNSUPPORTED_ALGORITHM,
        `Algorithm '${algorithm}' not supported`
      );
    }

    if (!unverifiedHeader.kid) {
      this.logger?.error('Token missing key ID (kid)');
      throw new TokenValidationError(TokenValidationErrorCode.MISSING_KEY_ID, 'Token missing key ID (kid)');
    }

    const publicKey = await this.getPublicKey(jwksClient, unverifiedHeader.kid);

    let verifiedPayload: IBotFrameworkJwtPayload;
    try {
      const verifiedToken = verify(rawToken, publicKey, {
        algorithms: [algorithm],
        audience: this.appId,
        issuer: EXPECTED_ISSUER,
      });

      if (typeof verifiedToken === 'string' || !verifiedToken) {
        throw new Error('Invalid token verification result');
      }

      verifiedPayload = verifiedToken;
    } catch (error) {
      this.logger?.error(`JWT signature verification failed: ${error}`);
      throw new TokenValidationError(
        TokenValidationErrorCode.SIGNATURE_VERIFICATION_FAILED,
        'Signature verification failed'
      );
    }

    if (serviceUrl) {
      this.validateServiceUrl(verifiedPayload, serviceUrl);
    }

    this.logger?.debug('Bot Framework token validation successful');
    return verifiedPayload;
  }

  private validateBasicClaims(payload: IBotFrameworkJwtPayload): void {
    if (payload.iss !== EXPECTED_ISSUER) {
      this.logger?.error(`Invalid issuer: ${payload.iss}`);
      throw new TokenValidationError(TokenValidationErrorCode.INVALID_ISSUER, `Invalid issuer: ${payload.iss}`);
    }

    if (payload.aud !== this.appId) {
      this.logger?.error(`Invalid audience: ${payload.aud}`);
      throw new TokenValidationError(TokenValidationErrorCode.INVALID_AUDIENCE, `Invalid audience: ${payload.aud}`);
    }

    if (!payload.exp) {
      this.logger?.error('Token missing expiration claim');
      throw new TokenValidationError(TokenValidationErrorCode.MALFORMED_TOKEN, 'Token missing expiration claim');
    }

    const currentTime = Math.floor(Date.now() / 1000);

    if (currentTime > (payload.exp + EXPIRATION_BUFFER_SECONDS)) {
      this.logger?.error('Token is expired');
      throw new TokenValidationError(TokenValidationErrorCode.EXPIRED_TOKEN, 'Token is expired');
    }

    if (payload.iat && (currentTime + EXPIRATION_BUFFER_SECONDS) < payload.iat) {
      this.logger?.error('Token issued in the future');
      throw new TokenValidationError(TokenValidationErrorCode.FUTURE_TOKEN, 'Token issued in the future');
    }
  }

  private validateServiceUrl(payload: IBotFrameworkJwtPayload, expectedServiceUrl: string): void {
    const tokenServiceUrl = payload.serviceurl;

    if (!tokenServiceUrl) {
      this.logger?.error('Token missing serviceurl claim');
      throw new TokenValidationError(TokenValidationErrorCode.MISSING_SERVICE_URL, 'Token missing serviceurl claim');
    }

    const normalizedTokenUrl = tokenServiceUrl.replace(/\/$/, '').toLowerCase();
    const normalizedExpectedUrl = expectedServiceUrl.replace(/\/$/, '').toLowerCase();

    if (normalizedTokenUrl !== normalizedExpectedUrl) {
      this.logger?.error(`Service URL mismatch. Token: ${normalizedTokenUrl}, Expected: ${normalizedExpectedUrl}`);
      throw new TokenValidationError(
        TokenValidationErrorCode.SERVICE_URL_MISMATCH,
        `Service URL mismatch. Token: ${normalizedTokenUrl}, Expected: ${normalizedExpectedUrl}`
      );
    }
  }

  private getJwksClient(metadata: IOpenIdMetadata): jwksClient.JwksClient | null {
    if (!metadata.jwks_uri) {
      return null;
    }

    // Check if we need to recreate the client (no client exists or URI changed)
    if (this.jwksClient && this.currentJwksUri === metadata.jwks_uri) {
      return this.jwksClient;
    }

    this.jwksClient = jwksClient({
      cache: true,
      cacheMaxAge: CACHE_TTL,
      jwksUri: metadata.jwks_uri,
    });
    this.currentJwksUri = metadata.jwks_uri;
    this.logger?.debug(`${!this.jwksClient ? 'Initialized' : 'Recreated'} JWKS client with URI: ${metadata.jwks_uri}`);

    return this.jwksClient;
  }

  private async getPublicKey(jwksClient: jwksClient.JwksClient, kid: string): Promise<string> {
    try {
      const key = await jwksClient.getSigningKey(kid);
      return key.getPublicKey();
    } catch (error) {
      this.logger?.error(`Failed to get signing key for kid ${kid}: ${error}`);
      throw new TokenValidationError(
        TokenValidationErrorCode.KEY_NOT_FOUND,
        `Failed to get signing key for kid: ${kid}`
      );
    }
  }

  private async getOpenIdMetadata(): Promise<IOpenIdMetadata | null> {
    const currentTime = Date.now();

    if (this.metadataCache && currentTime < this.metadataCache.expiry) {
      return this.metadataCache.data;
    }

    try {
      const response = (await this.client.get<IOpenIdMetadata>(OPEN_ID_CONFIG_URL))?.data;

      this.metadataCache = {
        data: response,
        expiry: currentTime + CACHE_TTL,
      };

      this.logger?.debug(`Retrieved OpenID metadata from ${OPEN_ID_CONFIG_URL}`);
      return response;
    } catch (error) {
      this.logger?.error(`Failed to retrieve OpenID metadata: ${error}`);
      return null;
    }
  }
}