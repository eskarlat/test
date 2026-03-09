import type { ExtensionModule } from "@renre-kit/extension-sdk";
import TasksPage from "./pages/TasksPage.js";
import TaskDetailPage from "./pages/TaskDetailPage.js";

const module: ExtensionModule = {
  pages: {
    tasks: TasksPage,
    "task-detail": TaskDetailPage,
  },
};

export default module;
export const { pages } = module;
