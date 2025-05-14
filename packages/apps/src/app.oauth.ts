import { AxiosError } from 'axios';

import {
  ISignInTokenExchangeInvokeActivity,
  ISignInVerifyStateInvokeActivity,
  TokenExchangeInvokeResponse,
} from '@microsoft/teams.api';
import * as graph from '@microsoft/teams.graph';

import { App } from './app';
import * as contexts from './contexts';
import { IPlugin } from './types';

export async function onTokenExchange<TPlugin extends IPlugin>(
  this: App<TPlugin>,
  ctx: contexts.IActivityContext<ISignInTokenExchangeInvokeActivity>
) {
  const { api, activity, log } = ctx;

  if (this.oauth.defaultConnectionName !== activity.value.connectionName) {
    log.warn(
      `default connection name "${this.oauth.defaultConnectionName}" does not match activity connection name "${activity.value.connectionName}"`
    );
  }

  try {
    const token = await api.users.token.exchange({
      channelId: activity.channelId,
      userId: activity.from.id,
      connectionName: activity.value.connectionName,
      exchangeRequest: {
        token: activity.value.token,
      },
    });

    ctx.userGraph = new graph.Client(
      this.client.clone({
        token: token.token,
      })
    );

    this.events.emit('signin', { ...ctx, token, isSignedIn: true });
    return { status: 200 };
  } catch (error) {
    if (error instanceof AxiosError) {
      if (error.status !== 404 && error.status !== 400 && error.status !== 412) {
        this.events.emit('error', { error, activity });
        return { status: error.status || 500 };
      }
    }

    return {
      status: 412,
      body: {
        id: activity.value.id,
        connectionName: activity.value.connectionName,
        failureDetail: 'unable to exchange token...',
      } as TokenExchangeInvokeResponse,
    };
  }
}

export async function onVerifyState<TPlugin extends IPlugin>(
  this: App<TPlugin>,
  ctx: contexts.IActivityContext<ISignInVerifyStateInvokeActivity>
) {
  const { log, api, activity } = ctx;

  try {
    if (!activity.value.state) {
      log.warn(
        `auth state not found for conversation "${activity.conversation.id}" and user "${activity.from.id}"`
      );
      return { status: 404 };
    }

    const token = await api.users.token.get({
      channelId: activity.channelId,
      userId: activity.from.id,
      connectionName: this.oauth.defaultConnectionName,
      code: activity.value.state,
    });

    ctx.userGraph = new graph.Client(
      this.client.clone({
        token: token.token,
      })
    );

    this.events.emit('signin', { ...ctx, token, isSignedIn: true });
    return { status: 200 };
  } catch (error) {
    if (error instanceof AxiosError) {
      if (error.status !== 404 && error.status !== 400 && error.status !== 412) {
        this.events.emit('error', { error, activity });
        return { status: error.status || 500 };
      }
    }

    return { status: 412 };
  }
}