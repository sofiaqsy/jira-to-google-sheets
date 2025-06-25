# JIRA to Google Sheets

Aplicación para extraer información de tickets E2E de JIRA y exportarla a Google Sheets.

## 🚨 Solución al Error 500

El error 500 que estás viendo se debe a problemas de autenticación con JIRA. Las mejoras implementadas incluyen:

1. **Validación de cookies**: Ahora la aplicación verifica que las cookies estén configuradas antes de hacer solicitudes.
2. **Reintentos automáticos**: Implementa reintentos con backoff exponencial para manejar errores temporales.
3. **Mejor manejo de errores**: Mensajes de error más claros y específicos.
4. **Endpoint de diagnóstico**: Nuevo endpoint `/api/config-status` para verificar la configuración.

## 📋 Configuración Requerida

### Variables de Entorno en Heroku

1. **JIRA_COOKIES** (OBLIGATORIO): Las cookies de autenticación de JIRA
2. **GOOGLE_CREDENTIALS_JSON**: Credenciales de Google en formato JSON
3. **GOOGLE_SHEET_ID**: ID de la hoja de Google Sheets
4. **JIRA_BASE_URL** (opcional): URL base de JIRA (por defecto: https://jira.globaldevtools.bbva.com)

### 🍪 Cómo obtener las cookies de JIRA

1. Inicia sesión en JIRA en tu navegador
2. Abre las herramientas de desarrollador (F12)
3. Ve a la pestaña "Network" o "Red"
4. Recarga la página
5. Busca cualquier solicitud a JIRA
6. En los headers de la solicitud, copia el valor completo del header "Cookie"
7. Configura esta cadena en la variable de entorno JIRA_COOKIES en Heroku

**Ejemplo de formato de cookies:**
```
atlassian.xsrf.token=xxx; JSESSIONID=xxx; seraph.rememberme.cookie=xxx
```

### Configurar en Heroku

```bash
heroku config:set JIRA_COOKIES="tu_cadena_de_cookies_aqui" -a tu-app-name
```

## 🔧 Verificar la Configuración

Después de configurar las variables, puedes verificar que todo esté correcto:

```bash
# Verificar el estado de salud
curl https://tu-app.herokuapp.com/health

# Verificar la configuración
curl https://tu-app.herokuapp.com/api/config-status
```

## 📝 Uso

1. Accede a la aplicación en tu URL de Heroku
2. Ingresa el ID del ticket E2E (ej: E2E-295970)
3. Opcionalmente, pega nuevas cookies si las anteriores expiraron
4. Haz clic en "Procesar"

## 🔄 Si las cookies expiran

Las cookies de JIRA tienen una duración limitada. Si empiezas a ver errores 401:

1. Obtén nuevas cookies siguiendo los pasos anteriores
2. Actualiza la variable en Heroku:
   ```bash
   heroku config:set JIRA_COOKIES="nuevas_cookies" -a tu-app
   ```
3. O pégalas directamente en el campo de cookies de la interfaz web

## 🐛 Debugging

Si sigues teniendo problemas:

1. Revisa los logs de Heroku:
   ```bash
   heroku logs --tail -a tu-app
   ```

2. Verifica que las cookies contengan al menos:
   - `JSESSIONID`
   - `atlassian.xsrf.token`

3. Asegúrate de que el usuario tenga permisos para acceder a los tickets E2E y features relacionadas en JIRA

## 🚀 Deploy

Los cambios ya están en la rama `fix-jira-auth-error`. Para aplicarlos:

1. Merge el pull request
2. Heroku debería hacer el deploy automáticamente
3. Si no, puedes forzarlo:
   ```bash
   git push heroku main
   ```
