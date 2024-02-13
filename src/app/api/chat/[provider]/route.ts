import { Langfuse } from 'langfuse';

import { getPreferredRegion } from '@/app/api/config';
import { createErrorResponse } from '@/app/api/errorResponse';
import { LOBE_CHAT_AUTH_HEADER, OAUTH_AUTHORIZED } from '@/const/auth';
import {
  AgentInitErrorPayload,
  AgentRuntimeError,
  ChatCompletionErrorPayload,
  ILobeAgentRuntimeErrorType,
} from '@/libs/agent-runtime';
import { ChatErrorType } from '@/types/fetch';
import { ChatStreamPayload } from '@/types/openai/chat';

import { checkAuthMethod, getJWTPayload } from '../auth';
import AgentRuntime from './agentRuntime';

export const runtime = 'edge';

export const preferredRegion = getPreferredRegion();

export const POST = async (req: Request, { params }: { params: { provider: string } }) => {
  let agentRuntime: AgentRuntime;

  // ============  1. init chat model   ============ //

  try {
    // get Authorization from header
    const authorization = req.headers.get(LOBE_CHAT_AUTH_HEADER);
    const oauthAuthorized = !!req.headers.get(OAUTH_AUTHORIZED);

    if (!authorization) throw AgentRuntimeError.createError(ChatErrorType.Unauthorized);

    // check the Auth With payload
    const payload = await getJWTPayload(authorization);
    checkAuthMethod(payload.accessCode, payload.apiKey, oauthAuthorized);

    const body = await req.clone().json();
    agentRuntime = await AgentRuntime.initializeWithUserPayload(params.provider, payload, {
      apiVersion: payload.azureApiVersion,
      model: body.model,
      useAzure: payload.useAzure,
    });
  } catch (e) {
    // if catch the error, just return it
    const err = e as AgentInitErrorPayload;
    return createErrorResponse(
      (err.errorType || ChatErrorType.InternalServerError) as ILobeAgentRuntimeErrorType,
      {
        error: err.error || e,
        provider: params.provider,
      },
    );
  }

  // ============  2. create chat completion   ============ //

  try {
    const payload = (await req.json()) as ChatStreamPayload;

    let startTime: Date;
    const langfuse = new Langfuse();
    const trace = langfuse.trace({
      input: payload.messages,
      metadata: { provider: params.provider },
    });

    return await agentRuntime.chat(payload, {
      experimental_onToolCall: async (toolCallPayload) => {
        console.log('toolCallPayload:', toolCallPayload);
        trace.update({ tags: ['Function Call'] });
      },
      onCompletion: async (completion) => {
        const { messages, model, tools, ...parameters } = payload;
        trace.generation({
          endTime: new Date(),
          input: messages,
          metadata: { tools },
          model,
          modelParameters: parameters as any,
          output: completion,
          startTime,
        });

        trace.update({ output: completion });
      },
      onFinal: async () => {
        await trace.client.shutdownAsync();
      },
      onStart: () => {
        startTime = new Date();
      },
    });
  } catch (e) {
    const { errorType, provider, error: errorContent, ...res } = e as ChatCompletionErrorPayload;

    // track the error at server side
    console.error(`Route: [${provider}] ${errorType}:`, errorContent);

    return createErrorResponse(errorType, { error: errorContent, provider, ...res });
  }
};
