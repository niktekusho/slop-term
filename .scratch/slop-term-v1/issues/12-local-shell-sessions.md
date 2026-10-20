# Local shell sessions

Type: grilling
Status: open
Blocked by:

## Question

Are local shells Saved sessions in the tree, and what does one store and where?

Points to settle: which shells the app offers on each system (PowerShell, cmd, each WSL distro, zsh); whether local shells sit in the Saved-session tree with folders or in a separate list, given they aren't SSH config entries; what a local shell session stores (shell, WSL distro, start folder, a command to run, such as `docker exec -it <container> bash`) and whether that goes in the Sidecar file or elsewhere; how sessions sync between Windows and macOS when a shell exists on only one of them; what an imported MobaXterm WSL session (type 14) becomes, from "How MobaXterm sessions map onto slop-term". WSL is a must. Docker needs no Docker code: a container shell is a local shell session that runs a command. The glossary defines a Saved session as SSH-only today, so the answer changes it.
