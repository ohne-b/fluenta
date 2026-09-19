import { createContext, useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ContentRef } from "@fluenta/contracts";
import { call } from "./ipc";

export const AppActions = createContext<{
  reference: (content?: ContentRef) => void;
}>({ reference: () => {} });
export const useAppActions = () => useContext(AppActions);
export const useSettings = () =>
  useQuery({
    queryKey: ["settings"],
    queryFn: () => call({ command: "get_settings" }, "settings"),
    staleTime: Infinity,
  });
export const useOverview = () =>
  useQuery({
    queryKey: ["overview"],
    queryFn: () => call({ command: "get_overview" }, "overview"),
  });
