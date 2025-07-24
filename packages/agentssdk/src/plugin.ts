import express from 'express';

import {
  AgentApplication,
  AuthConfiguration,
  CloudAdapter,
  loadAuthConfigFromEnv,
  TurnState,
} from '@microsoft/agents-hosting';


import { $Activity, Activity, Credentials, IToken, JsonWebToken } from '@microsoft/teams.api';
import {
  Dependency,
  Event,
  HttpPlugin,
  IActivityEvent,
  IErrorEvent,
  ISender,
  Logger,
  Plugin,
  manifest,
} from '@microsoft/teams.apps';
import { ILogger } from '@microsoft/teams.common';
import * as $http from '@microsoft/teams.common/http';

import pkg from '../package.json';

export type AgentSDKPluginOptions<TState extends TurnState = TurnState> = {
  readonly adapter?: CloudAdapter;
  readonly application?: AgentApplication<TState>;
};

@Plugin({
  name: 'http',
  version: pkg.version,
})
export class AgentsSDKPlugin<TState extends TurnState = TurnState> extends HttpPlugin implements ISender {
  @Logger()
  declare readonly logger: ILogger;

  @Dependency()
  declare readonly client: $http.Client;

  @Dependency()
  declare readonly manifest: Partial<manifest.Manifest>;

  @Dependency({ optional: true })
  declare readonly botToken?: () => IToken;

  @Dependency({ optional: true })
  declare readonly graphToken?: () => IToken;

  @Dependency({ optional: true })
  readonly credentials?: Credentials;

  @Event('error')
  declare readonly $onError: (event: IErrorEvent) => void;

  @Event('activity')
  declare readonly $onActivity: (event: IActivityEvent) => void;

  protected adapter?: CloudAdapter;
  protected application?: AgentApplication<TState>;

  constructor(options?: AgentSDKPluginOptions<TState>) {
    super();
    this.adapter = options?.adapter;
    this.application = options?.application;
  }

  onInit() {
    if (!this.adapter) {
      const authConfig: AuthConfiguration = loadAuthConfigFromEnv();
      this.adapter = new CloudAdapter(authConfig);
    }
  }

  protected async onRequest(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) {
    if (!this.adapter) {
      throw new Error('plugin not registered');
    }

    try {
      const authorization = req.headers.authorization?.replace('Bearer ', '');

      if (!authorization) {
        res.status(401).send('unauthorized');
        return;
      }

      await this.adapter.process(req, res, async (context) => {
        if (!context.activity.id) return;

        if (this.application) {
          await this.application.run(context);
        }

        if (res.headersSent) {
          return next();
        }

        this.pending[context.activity.id] = res;
        const activity = JSON.parse(context.activity.toJsonString());
        this.$onActivity({
          sender: this,
          token: new JsonWebToken(authorization),
          activity: new $Activity(activity as any) as Activity,
        });
      });
    } catch (err) {
      this.logger.error(err);

      if (!res.headersSent) {
        res.status(500).send('internal server error');
      }
    }
  }
}
