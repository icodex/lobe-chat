import { StreamingTextResponse } from 'ai';

import { ChatStreamCallbacks, ChatStreamPayload } from './types';

export interface LobeRuntimeAI {
  baseURL?: string;

  chat(
    payload: ChatStreamPayload,
    streamCallbacks?: ChatStreamCallbacks,
  ): Promise<StreamingTextResponse>;
}
