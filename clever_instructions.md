Comment configurer l'app Clever:
```bash
# 1. Créer l'application
clever create ‐‐org orga_e4d64185-94d8-4d10-9d26-31b39dafd743 --type node --name todo-bassier
# 2. Créer et attacher le PostgreSQL
clever addon create postgresql-addon --plan dev --name pg-todo-bassier ‐‐org orga_e4d64185-94d8-4d10-9d26-31b39dafd743
clever service link-addon pg-todo-bassier
# 3. Configurer les variables
clever env set APP_NAME=bassier
# 4. Déployer
git push clever main
```
