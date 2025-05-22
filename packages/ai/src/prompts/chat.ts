import { ConsoleLogger, ILogger } from '@microsoft/teams.common';

import { Function, FunctionHandler } from '../function';
import { LocalMemory } from '../local-memory';
import { IMemory } from '../memory';
import { ContentPart, SystemMessage, UserMessage } from '../message';
import { IChatModel } from '../models';
import { Schema } from '../schema';
import { ITemplate } from '../template';
import { StringTemplate } from '../templates';
import { WithRequired } from '../utils/types';
import { ChatPromptOptions, ChatPromptPlugin, ChatPromptSendOptions, IChatPrompt } from './chat-types';

/**
 * a prompt that can interface with a
 * chat model that provides utility like
 * streaming and function calling
 */
export class ChatPrompt<
  TOptions extends Record<string, any> = Record<string, any>,
  TRawReturnType extends Record<string, any> = Record<string, any>,
  TChatPromptPlugins extends readonly ChatPromptPlugin<string, any>[] = [],
> implements IChatPrompt<TOptions, TRawReturnType, TChatPromptPlugins> {
  get name() {
    return this._name;
  }
  protected readonly _name: string;

  get description() {
    return this._description;
  }
  protected readonly _description: string;

  get messages() {
    return this._messages;
  }
  protected readonly _messages: IMemory;

  get functions() {
    return Object.values(this._functions);
  }
  protected readonly _functions: Record<string, Function> = {};

  get plugins() {
    return this._plugins;
  }
  protected readonly _plugins: TChatPromptPlugins;

  protected readonly _role: 'system' | 'user';
  protected readonly _template: ITemplate;
  protected readonly _model: IChatModel<TOptions, TRawReturnType>;
  protected readonly _log: ILogger;

  constructor(options: ChatPromptOptions<TOptions, TRawReturnType>, plugins?: TChatPromptPlugins) {
    this._name = options.name || 'chat';
    this._description = options.description || 'an agent you can chat with';
    this._role = options.role || 'system';
    this._model = options.model;
    this._template = Array.isArray(options.instructions)
      ? new StringTemplate(options.instructions.join('\n'))
      : typeof options.instructions !== 'object'
        ? new StringTemplate(options.instructions)
        : options.instructions;

    this._messages =
      typeof options.messages === 'object' && !Array.isArray(options.messages)
        ? options.messages
        : new LocalMemory({ messages: options.messages || [] });

    this._plugins = plugins || ([] as unknown as TChatPromptPlugins);
    this._log = options.logger || new ConsoleLogger(`@microsoft/teams.ai/prompts/${this._name}`);
  }

  use(prompt: IChatPrompt): this;
  use(name: string, prompt: IChatPrompt): this;
  use(...args: any[]) {
    const prompt: IChatPrompt = args.length === 1 ? args[0] : args[1];
    const name: string = args.length === 1 ? prompt.name : args[0];
    this._functions[name] = {
      name,
      description: prompt.description,
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'the text to send to the assistant',
          },
        },
        required: ['text'],
      },
      handler: ({ text }: { text: string }) => {
        return prompt.send(text);
      },
    };

    return this;
  }

  function(name: string, description: string, handler: FunctionHandler): this;
  function(name: string, description: string, parameters: Schema, handler: FunctionHandler): this;
  function(...args: any[]) {
    const name: string = args[0];
    const description: string = args[1];
    const parameters: Schema | null = args.length === 3 ? null : args[2];
    const handler: FunctionHandler = args[args.length - 1];
    this._functions[name] = {
      name,
      description,
      parameters: parameters || {},
      handler,
    };

    return this;
  }

  usePlugin<K extends TChatPromptPlugins[number]['name']>(
    name: K,
    args: Extract<TChatPromptPlugins[number], { name: K }>['onUsePlugin'] extends
      | ((args: infer U) => void)
      | undefined
      ? U
      : never
  ): this {
    const plugin = this._plugins.find((p) => p.name === name);
    if (!plugin) {
      this._log.debug(`Plugin "${name}" not found`);
      throw new Error(`Plugin "${name}" not found`);
    }

    if (plugin.onUsePlugin) {
      this._log.debug(`Using plugin "${name}" with args:`, args);
      plugin.onUsePlugin(args);
      this._log.debug(`Successfully initialized plugin "${name}"`);
    }

    return this;
  }

  async call<A extends { [key: string]: any }, R = any>(name: string, args?: A): Promise<R> {
    const fn = this._functions[name];
    if (!fn) {
      throw new Error(`function "${name}" not found`);
    }
    return this.executeFunction(name, fn, args);
  }

  async send(input: string | ContentPart[], options: ChatPromptSendOptions<TOptions> = {}) {
    this._log.debug(`Processing plugins before send (${this.plugins.length} plugins found)`);
    for (const plugin of this.plugins) {
      if (plugin.onBeforeSend) {
        this._log.debug(`Running onBeforeSend for plugin "${plugin.name}"`);
        input = await plugin.onBeforeSend(input);
      }
    }

    const { onChunk } = options;

    if (typeof input === 'string') {
      input = input.trim();
    }

    const messages = !Array.isArray(options.messages)
      ? options.messages || this._messages
      : new LocalMemory({ messages: options.messages || [] });

    let buffer = '';
    let system: SystemMessage | UserMessage | undefined = undefined;
    let prompt = await this._template.render();

    for (const plugin of this.plugins) {
      if (plugin.onBuildPrompt) {
        const nextPrompt = await plugin.onBuildPrompt(prompt);
        if (nextPrompt != null && nextPrompt !== prompt) {
          this._log.debug(`Plugin "${plugin.name}" modified the system prompt`);
          prompt = nextPrompt;
        }
      }
    }

    if (prompt) {
      system = {
        role: this._role,
        content: prompt,
      };
      this._log.debug('System instructions for LLM:', prompt);
    }

    let functions = Object.values(this._functions);
    const pluginsWithOnBuildFunctions = this._plugins.filter(
      (plugin): plugin is WithRequired<TChatPromptPlugins[number], 'onBuildFunctions'> =>
        plugin.onBuildFunctions != null
    );
    for (const plugin of pluginsWithOnBuildFunctions) {
      functions = await plugin.onBuildFunctions(functions);
    }

    const fnMap = functions.reduce((acc, fn) => {
      acc[fn.name] = {
        ...fn,
        handler: (args: any) => this.executeFunction(fn.name, fn, args),
      };
      return acc;
    }, {} as Record<string, Function>);

    if (Object.keys(fnMap).length > 0) {
      this._log.debug(
        'Available functions for LLM:',
        Object.keys(fnMap).map((name) => {
          const fn = fnMap[name];
          const paramDescriptions =
            'properties' in fn.parameters && fn.parameters.properties
              ? Object.entries(
                fn.parameters.properties as Record<string, { description?: string }>
              ).reduce(
                (acc, [key, prop]) => ({
                  ...acc,
                  [key]: prop.description,
                }),
                {} as Record<string, string | undefined>
              )
              : {};

          return {
            name,
            description: fn.description,
            parameters: {
              schema: fn.parameters,
              descriptions: paramDescriptions,
            },
          };
        })
      );
    }

    const res = await this._model.send(
      {
        role: 'user',
        content: input,
      },
      {
        system,
        messages,
        request: options.request,
        functions: fnMap,
        onChunk: async (chunk) => {
          if (!chunk || !onChunk) return;
          buffer += chunk;

          try {
            await onChunk(buffer);
            buffer = '';
          } catch (err) {
            return;
          }
        },
        disableAutomaticFunctionCalling: options.disableAutomaticFunctionCalling,
      }
    );

    let output: Awaited<ReturnType<typeof this._model.send>> = {
      ...res,
      content: res.content || '',
    };

    // Log function calls if present
    if (output.function_calls && output.function_calls.length > 0) {
      this._log.debug(
        'LLM requested function calls:',
        output.function_calls.map((call) => ({
          name: call.name,
          id: call.id,
          arguments: call.arguments,
        }))
      );
    }

    this._log.debug(`Processing plugins after send (${this.plugins.length} plugins found)`);
    for (const plugin of this.plugins) {
      if (plugin.onAfterSend) {
        this._log.debug(`Running onAfterSend for plugin "${plugin.name}"`);
        // Casting to the same type as the output, this is technically unsafe. We should be doing some validation with 
        // the output of the plugin to ensure that it's adhering to the expected type.
        output = await plugin.onAfterSend(output) as typeof output;
      }
    }

    return output;
  }

  protected async executeFunction<R = any>(
    name: string,
    fn: Function,
    args?: Record<string, any>
  ): Promise<R> {
    const processedArgs = args || {};

    // Execute beforeFunctionCall hooks
    for (const plugin of this.plugins) {
      if (plugin.onBeforeFunctionCall) {
        await plugin.onBeforeFunctionCall(name, processedArgs);
      }
    }

    // Call the function
    let result = await fn.handler(processedArgs);

    // Execute afterFunctionCall hooks
    for (const plugin of this.plugins) {
      if (plugin.onAfterFunctionCall) {
        result = await plugin.onAfterFunctionCall(name, processedArgs, result);
      }
    }

    return result;
  }
}
