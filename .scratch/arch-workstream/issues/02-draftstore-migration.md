# 02: draftstore migration

**What to build:**

Toute la persistance du CLI passe par le port `DraftStore` injectable, sur le motif déjà en production dans le module edit (store en paramètre par défaut, signature-compatible : les appelants du dispatcher ne changent pas). Les dix fichiers qui appellent encore la façade globale sont migrés un par un, puis la façade dépréciée — les fonctions globales ET la map d'état caché qu'elle entretient — est supprimée du module draft. À la clôture, il existe exactement un idiome de sauvegarde dans le codebase.

Motif par call site (mécanique) : la fonction reçoit le store en paramètre par défaut, l'appel remplace la façade par le point d'entrée persistant du store. Les tests concernés injectent un store en mémoire là où c'est utile ; leur comportement et leurs assertions restent inchangés.

**Acceptance criteria:**

- [ ] Les dix fichiers à call sites migrent au motif du module edit (paramètre par défaut, signature-compatible)
- [ ] La façade globale et sa map d'état caché sont supprimées : plus aucun import ni référence
- [ ] Le golden-output reste identique (contrats JSON et exit codes inchangés)
- [ ] Les tests au comportement inchangé passent ; un store en mémoire est injectable dans les commandes d'écriture
- [ ] Coverage ≥80 % maintenue, CI 15/15 verte

**Status:** ready-for-agent

**Blocked by:** 01 - golden-output

**Spec:** voir `00-spec-chantier-arch.md` (ce dossier)
