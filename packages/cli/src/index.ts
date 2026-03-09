import { Command } from "commander";
import { registerInitCommand } from "./commands/init.js";
import { registerStartCommand } from "./commands/start.js";
import { registerStopCommand } from "./commands/stop.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerUninstallCommand } from "./commands/uninstall.js";
import { registerExtensionCommand } from "./commands/extension.js";
import { registerQueryCommand } from "./commands/query.js";
import { registerMarketplaceCommand } from "./commands/marketplace.js";
import { registerBackupCommand } from "./commands/backup.js";

const program = new Command();

program
  .name("renre-kit")
  .description("AI agent context provider CLI")
  .version("0.1.0");

registerInitCommand(program);
registerStartCommand(program);
registerStopCommand(program);
registerStatusCommand(program);
registerUninstallCommand(program);
registerExtensionCommand(program);
registerQueryCommand(program);
registerMarketplaceCommand(program);
registerBackupCommand(program);

program.parse();
