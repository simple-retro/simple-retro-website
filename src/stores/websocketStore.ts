import { defineStore } from 'pinia';
import { capitalize, ref } from 'vue';
import { API_URL, Endpoints } from '../services';

import { NotificationType, useNotifyStore } from './notifyStore';
import retrospectiveApi from '../services/retrospectiveApi';
import { Question, useRetrospectiveStore } from './retrospectiveStore';

type SocketActions = 'create' | 'update' | 'delete';
type SocketEntity = 'question' | 'retrospective' | 'answer';

type SocketMessage = {
  action: SocketActions;
  type: SocketEntity;
  value: unknown;
};

export const useWebsocketStore = defineStore('websocket', () => {
  const notifyStore = useNotifyStore();
  const retroStore = useRetrospectiveStore();

  const websocket = ref<WebSocket>();
  let retrospectiveId = '';

  let reconnectTimeout: number;
  let retries = 0;

  const reconnectLogic = () => {
    if (retries >= 3) return destroy('The Websocket connection could not be restablished');

    reconnectTimeout = setTimeout(
      () => {
        retries += 1;
        console.log(`Retrying connection for the ${retries} time`);
        connect(retrospectiveId);
      },
      1000 * retries || 500,
    );
  };

  const onMessage = (message: MessageEvent<string>) => {
    const data = JSON.parse(message.data) as SocketMessage;

    const functionName = `${data.action}${capitalize(data.type)}` as const;

    const toExecute = retroStore[data.type as 'question'][functionName as 'createQuestion'];

    if (toExecute === undefined)
      return notifyStore.notify(
        `Unsuported event sent in websocket. Action: "${data.action}", Type: "${data.type}"`,
        NotificationType.Error,
      );

    toExecute(data.value as Question);
  };

  const onConnect = async () => {
    clearTimeout(reconnectTimeout);
    retries = 0;

    const retro = await retrospectiveApi.getRetrospective(retrospectiveId);
    if (!retro.error) retroStore.retrospective.updateRetrospective(retro);

    notifyStore.notify(`Websocket connected`, NotificationType.Success);
  };

  const onError = (e: unknown) => {
    console.log('Websocket error', e);
  };

  const onClose = () => {
    notifyStore.notify(`The websocket connection has been closed`, NotificationType.Warning);
    reconnectLogic();
  };

  const connect = (retroId: string) => {
    if (
      websocket.value !== undefined &&
      [websocket.value.OPEN, websocket.value.CONNECTING].includes(websocket.value.readyState as 0)
    )
      return;

    websocket.value = new WebSocket(
      `${import.meta.env.PROD ? 'wss' : 'ws'}://${API_URL}${Endpoints.SocketHello}/${retroId}`,
    );
    retrospectiveId = retroId;

    websocket.value.onerror = onError;
    websocket.value.onopen = onConnect;
    websocket.value.onmessage = onMessage;
    websocket.value.onclose = onClose;
  };

  const destroy = (reason?: string) => {
    clearTimeout(reconnectTimeout);

    websocket.value?.close(3015, 'Its a panic from my side. Do not take it bad');
    websocket.value = undefined;

    notifyStore.panic(
      reason ?? 'The websocket connection was destroyed',
      retroStore.currentRetro?.id ?? '0',
      false,
    );
  };

  return { websocket, connect, destroy };
});
