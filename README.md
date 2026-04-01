# clever-todo-list
## Eliott BASSIER DO3


Pour déveloper correctement en local, il est préférable de récupérer une base de données **postgres** via docker en executant dans le repertoire de ce projet : 
```bash
docker compose up
```

Variables d'environnement locales:
```
PORT=3000
POSTGRESQL_ADDON_URI=postgresql://user:password@localhost:5432/todos
APP_NAME=MonAppLocale # prédefini pour env local
```
APP_NAME sera surchargé une fois sur la plateforme Clever Cloud après avoir exécuté la commande:
```bash
clever env set APP_NAME=bassier
```


Les différentes commandes Clever que j'ai entrées pour déployer l'app sont :
```bash
# 1. Créer l'application
clever create --type node todo-bassier 
# 2. Créer et attacher le PostgreSQL
clever addon create postgresql-addon --plan dev pg-todo-bassier -
clever service link-addon pg-todo-bassier
# 3. Configurer les variables
clever env set APP_NAME bassier
# 4. Déployer
clever deploy
```
**Durant mes tests de la solution de todo déployée sur clever: j'ai rajouté aux 2 premieres commandes clever le flag ```--org <clever-id-org-polytech-do>```**
