import { config } from './env';

export const WS_CONFIG = {
    URL: config.wsUrl,
    SOCKET_IO_URL: config.socketIOUrl,
    RECONNECT_INTERVAL: 3000,
    MAX_RETRIES: 5,
    EVENTS: {
        CONNECT: 'connect',
        DISCONNECT: 'disconnect',
        ERROR: 'error',
        MESSAGE: 'message',
        JOIN_ROOM: 'join-room',
        LEAVE_ROOM: 'leave-room',
    },
};
