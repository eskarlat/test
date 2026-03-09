# RenRe kit CLI

## About project
Nowadays people use MCP to provide context to AI agents. RenRe Kit CLI provide different approach provide context from CLI. when user start CLI worker service start which is express nodejs application. server use port 42888. user can open server console by localhost:42888. 
Server build in sqlite and and it has only one route health. all functionality adds by extensions.

Extension is app that has backend routes that expand CLI nodejs for example adds new route /jira, /jira/add, /jira/issues, etc. extension also has UI react that will use as sidebar menu item and its page inside the console. for example: jira-plugin has UI / sessionsPage.tsx, issuesPage.tsx. sidebar in the console will have jira as main item and submenu sessions, issues. etc. 
plugin also could have migrations so they run to manage plugin table inside the plugin logic. 
plugin could hava/dont have UI, migrations. and even route is optional. plugin also will contains skills, hooks. 
plugins are github based. user can add marketplase to CLI or install plugins from local. 

#Workflow
1. user create folder
2. init renre-kit in the project. 
3. install needed extensions for particular project from market place or from local. (local .renre-kit has /extension.json with all project installed extensions. Extensions installs in ~/.renre-kit/extensions and reuse (server and UI)) if extension uses db -> db creates with projectid in the db.
4. run renre-kit console
5. server worker runs and user can access localhost:42888 and see project. 
  - console dashboard has dropdawn in toolbar "project" -> where user can see active started consoles() for example user works on different projects at the same time. and user can switch between them by dropdown. 
  - console runs once. all managed instenses of project consoles lives in ~/.renre-kit/sessions/{session-id}.
  - each project has its own sidebar because each project could have different extensions numbers and extension could have UI. one project has jira and sidebar showing jira menu item another dont have.
  - when user install extenison it also contain hooks as sessionStart or userPrompt etc. extension could inject its logic on these events. in .renre-kit in the project folder should be cretaed `.github/hooks/{extension-name}.json` extension also provide skills they need to be placed `.github/skills/{skill-name}/SKILL.md`. 

Technical stack

CLI typescript
worker-service nodojs express
db sqlite
UI react

References: 
Graffana plugin system. 

SKILL CLI flow https://github.com/vercel-labs/skills/tree/main with menu stepper

worker service
https://github.com/maxritter/pilot-shell
pilot shell