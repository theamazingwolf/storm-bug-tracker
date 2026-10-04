import { create } from "zustand";

export interface NativeChatGptProfile {
  id: string;
  email: string;
  signedIn: boolean;
  planEnabled: boolean;
}

export interface NativeChatGptModel {
  slug: string;
  displayName: string;
}

export interface NativeChatGptStatus {
  connected: boolean;
  activeProfileId: string | null;
  planEnabled: boolean;
  imageInput: "unsupported";
}

interface NativeChatGptUiState {
  transportConnected: boolean;
  hasCheckedHelper: boolean;
  status: NativeChatGptStatus | null;
  profiles: NativeChatGptProfile[];
  models: NativeChatGptModel[];
  modelsProfileId: string | null;
  setTransportConnected: (connected: boolean) => void;
  setSnapshot: (status: NativeChatGptStatus, profiles: NativeChatGptProfile[]) => void;
  setModels: (profileId: string, models: NativeChatGptModel[]) => void;
  clearModels: () => void;
  clearProfile: (profileId: string) => void;
  reset: () => void;
}

const initial = {
  transportConnected: false,
  hasCheckedHelper: false,
  status: null as NativeChatGptStatus | null,
  profiles: [] as NativeChatGptProfile[],
  models: [] as NativeChatGptModel[],
  modelsProfileId: null as string | null,
};

export const useNativeChatGptUiStore = create<NativeChatGptUiState>((set) => ({
  ...initial,
  setTransportConnected: (connected) => set(() => ({
    transportConnected: connected,
    ...(connected ? {} : { hasCheckedHelper: true, status: null, profiles: [], models: [], modelsProfileId: null }),
  })),
  setSnapshot: (status, profiles) => set({
    status,
    profiles,
    transportConnected: true,
    hasCheckedHelper: true,
    models: [],
    modelsProfileId: null,
  }),
  setModels: (profileId, models) => set({ models, modelsProfileId: profileId }),
  clearModels: () => set({ models: [], modelsProfileId: null }),
  clearProfile: (profileId) => set((state) => ({
    profiles: state.profiles.filter((profile) => profile.id !== profileId),
    models: state.modelsProfileId === profileId ? [] : state.models,
    modelsProfileId: state.modelsProfileId === profileId ? null : state.modelsProfileId,
  })),
  reset: () => set({ ...initial }),
}));
