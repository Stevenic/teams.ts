import { Client, ClientOptions } from '@microsoft/teams.common/http';

import { Account } from '../../models';

export class ConversationMemberClient {
  readonly serviceUrl: string;

  get http() {
    return this._http;
  }
  set http(v) {
    this._http = v;
  }
  protected _http: Client;

  constructor(serviceUrl: string, options?: Client | ClientOptions) {
    this.serviceUrl = serviceUrl;

    if (!options) {
      this._http = new Client();
    } else if ('request' in options) {
      this._http = options;
    } else {
      this._http = new Client(options);
    }
  }

  async get(conversationId: string) {
    const res = await this.http.get<Account[]>(
      `${this.serviceUrl}/v3/conversations/${conversationId}/members`
    );
    return res.data;
  }

  async getById(conversationId: string, id: string) {
    const res = await this.http.get<Account>(
      `${this.serviceUrl}/v3/conversations/${conversationId}/members/${id}`
    );
    return res.data;
  }

  async delete(conversationId: string, id: string) {
    const res = await this.http.delete<void>(
      `${this.serviceUrl}/v3/conversations/${conversationId}/members/${id}`
    );
    return res.data;
  }
}
