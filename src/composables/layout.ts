import { ref } from "vue";

/** Both halves of a query tab, or one of them alone (the buttons at the right of the status bar). */
export type PanelLayout = "default" | "editor" | "results";

const layout = ref<PanelLayout>("default");

export function useLayout() {
    return { layout };
}
