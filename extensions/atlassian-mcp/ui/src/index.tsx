import type { ExtensionModule } from "@renre-kit/extension-sdk";
import IssuesPage from "./pages/IssuesPage.js";
import MentionsPage from "./pages/MentionsPage.js";

const module: ExtensionModule = {
  pages: {
    issues: IssuesPage,
    mentions: MentionsPage,
  },
};

export default module;
export const { pages } = module;
