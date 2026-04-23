/**
 * 房间状态管理Store
 * 管理协作房间信息、房间用户、草稿状态等
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
    RoomStoreState,
    RoomStoreActions,
    RoomInfo,
    RoomUser,
    ModuleType
} from '../types/sync';

/** 初始状态 */
const initialState: RoomStoreState = {
    currentRoomId: null,
    currentModule: null,
    rooms: {},
    roomUsers: {},
    draftRooms: {},
    isLoading: false,
};

/** 房间Store类型 */
export type RoomStore = RoomStoreState & RoomStoreActions;

/**
 * 房间状态Store
 * 使用Zustand persist中间件将草稿状态持久化到localStorage
 */
export const useRoomStore = create<RoomStore>()(
    persist(
        (set, get) => ({
            ...initialState,

            // ============ 房间管理 ============

            setCurrentRoom: (roomId: string | null, module: ModuleType | null) => {
                const prevRoomId = get().currentRoomId;

                // 如果切换房间，记录日志
                if (prevRoomId !== roomId) {
                    console.log(`[RoomStore] Room changed: ${prevRoomId} -> ${roomId}`);
                }

                set({
                    currentRoomId: roomId,
                    currentModule: module
                });
            },

            joinRoom: (roomId: string, module: ModuleType) => {
                const { rooms } = get();

                // 如果房间不存在，创建新的房间信息
                if (!rooms[roomId]) {
                    const newRoom: RoomInfo = {
                        id: roomId,
                        projectId: roomId.split(':')[1] || roomId, // 假设格式为 "module:projectId"
                        module,
                        users: [],
                        createdAt: Date.now(),
                        lastActivity: Date.now(),
                    };

                    set((state) => ({
                        rooms: { ...state.rooms, [roomId]: newRoom },
                        roomUsers: { ...state.roomUsers, [roomId]: [] },
                    }));
                }

                // 更新当前房间
                set({
                    currentRoomId: roomId,
                    currentModule: module
                });

                // 更新房间活动时间
                get().updateRoomInfo(roomId, { lastActivity: Date.now() });

                console.log(`[RoomStore] Joined room: ${roomId} (${module})`);
            },

            leaveRoom: (roomId: string) => {
                const { currentRoomId } = get();

                // 如果离开的是当前房间，清除当前房间
                if (currentRoomId === roomId) {
                    set({
                        currentRoomId: null,
                        currentModule: null
                    });
                }

                console.log(`[RoomStore] Left room: ${roomId}`);
            },

            // ============ 房间信息 ============

            updateRoomInfo: (roomId: string, info: Partial<RoomInfo>) => {
                set((state) => ({
                    rooms: {
                        ...state.rooms,
                        [roomId]: state.rooms[roomId]
                            ? { ...state.rooms[roomId], ...info }
                            : undefined as unknown as RoomInfo, // 如果房间不存在，不更新
                    }
                }));
            },

            removeRoom: (roomId: string) => {
                set((state) => {
                    const { [roomId]: removedRoom, ...remainingRooms } = state.rooms;
                    const { [roomId]: removedUsers, ...remainingUsers } = state.roomUsers;
                    const { [roomId]: removedDraft, ...remainingDrafts } = state.draftRooms;

                    return {
                        rooms: remainingRooms,
                        roomUsers: remainingUsers,
                        draftRooms: remainingDrafts,
                        // 如果删除的是当前房间，清除当前房间
                        currentRoomId: state.currentRoomId === roomId ? null : state.currentRoomId,
                        currentModule: state.currentRoomId === roomId ? null : state.currentModule,
                    };
                });

                console.log(`[RoomStore] Removed room: ${roomId}`);
            },

            // ============ 用户管理 ============

            setRoomUsers: (roomId: string, users: RoomUser[]) => {
                set((state) => ({
                    roomUsers: { ...state.roomUsers, [roomId]: users }
                }));
            },

            addRoomUser: (roomId: string, user: RoomUser) => {
                set((state) => ({
                    roomUsers: {
                        ...state.roomUsers,
                        [roomId]: [...(state.roomUsers[roomId] || []), user]
                    }
                }));

                console.log(`[RoomStore] User joined room ${roomId}: ${user.name}`);
            },

            updateRoomUser: (roomId: string, userId: string, updates: Partial<RoomUser>) => {
                set((state) => ({
                    roomUsers: {
                        ...state.roomUsers,
                        [roomId]: (state.roomUsers[roomId] || []).map(user =>
                            user.id === userId ? { ...user, ...updates } : user
                        )
                    }
                }));
            },

            removeRoomUser: (roomId: string, userId: string) => {
                set((state) => ({
                    roomUsers: {
                        ...state.roomUsers,
                        [roomId]: (state.roomUsers[roomId] || []).filter(user => user.id !== userId)
                    }
                }));

                console.log(`[RoomStore] User left room ${roomId}: ${userId}`);
            },

            // ============ 草稿管理 ============

            markDraft: (roomId: string) => {
                set((state) => ({
                    draftRooms: { ...state.draftRooms, [roomId]: Date.now() }
                }));

                console.log(`[RoomStore] Draft marked for room: ${roomId}`);
            },

            clearDraft: (roomId: string) => {
                set((state) => {
                    const { [roomId]: removed, ...remaining } = state.draftRooms;
                    return { draftRooms: remaining };
                });

                console.log(`[RoomStore] Draft cleared for room: ${roomId}`);
            },

            // ============ 加载状态 ============

            setLoading: (isLoading: boolean) => {
                set({ isLoading });
            },

            // ============ 重置 ============

            reset: () => {
                set(initialState);
            },
        }),
        {
            name: 'room-store',
            storage: createJSONStorage(() => localStorage),
            // 只持久化草稿状态和最近房间
            partialize: (state) => ({
                draftRooms: state.draftRooms,
                // 只保留最近10个房间的基本信息
                rooms: Object.fromEntries(
                    Object.entries(state.rooms)
                        .sort((a, b) => b[1].lastActivity - a[1].lastActivity)
                        .slice(0, 10)
                        .map(([id, room]) => [id, { id: room.id, projectId: room.projectId, module: room.module, lastActivity: room.lastActivity }])
                ),
            }),
        }
    )
);

// ============ 选择器 ============

/** 获取当前房间ID的便捷选择器 */
export const selectCurrentRoomId = (state: RoomStore) => state.currentRoomId;

/** 获取当前模块的便捷选择器 */
export const selectCurrentModule = (state: RoomStore) => state.currentModule;

/** 获取当前房间信息的便捷选择器 */
export const selectCurrentRoom = (state: RoomStore) =>
    state.currentRoomId ? state.rooms[state.currentRoomId] : null;

/** 获取当前房间用户列表的便捷选择器 */
export const selectCurrentRoomUsers = (state: RoomStore) =>
    state.currentRoomId ? state.roomUsers[state.currentRoomId] || [] : [];

/** 获取指定房间的用户列表 */
export const selectRoomUsers = (roomId: string) => (state: RoomStore) =>
    state.roomUsers[roomId] || [];

/** 获取指定房间是否有草稿 */
export const selectHasDraft = (roomId: string) => (state: RoomStore) =>
    roomId in state.draftRooms;

/** 获取所有有草稿的房间ID */
export const selectDraftRoomIds = (state: RoomStore) =>
    Object.keys(state.draftRooms);

/** 获取在线用户数量 */
export const selectOnlineUsersCount = (roomId: string) => (state: RoomStore) =>
    (state.roomUsers[roomId] || []).filter(user => user.isOnline).length;
