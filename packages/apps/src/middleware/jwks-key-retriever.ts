import jwksClient from 'jwks-rsa';

import { Result } from '../types/result';

export type KeyRetrievalResult = Result<string>;

export class JwksKeyRetriever {
  private jwksClient?: jwksClient.JwksClient;
  private currentJwksUri?: string;
  private readonly cacheMaxAge: number;

  constructor(cacheMaxAge: number = 3600000) { // 1 hour default
    this.cacheMaxAge = cacheMaxAge;
  }

  async getPublicKey(kid: string, jwksUri: string): Promise<KeyRetrievalResult> {
    if (!kid) {
      return {
        success: false,
        error: 'Token missing key ID (kid)',
      };
    }

    const client = this.getJwksClient(jwksUri);
    if (!client) {
      return {
        success: false,
        error: 'Failed to initialize JWKS client',
      };
    }

    try {
      const key = await client.getSigningKey(kid);
      const publicKey = key.getPublicKey();
      
      return {
        success: true,
        data: publicKey,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get signing key for kid ${kid}: ${error}`,
      };
    }
  }

  private getJwksClient(jwksUri: string): jwksClient.JwksClient | null {
    if (!jwksUri) {
      return null;
    }

    // Check if we need to recreate the client (no client exists or URI changed)
    if (this.jwksClient && this.currentJwksUri === jwksUri) {
      return this.jwksClient;
    }

    this.jwksClient = jwksClient({
      cache: true,
      cacheMaxAge: this.cacheMaxAge,
      jwksUri,
    });
    this.currentJwksUri = jwksUri;

    return this.jwksClient;
  }
}