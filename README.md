# MQTT Robot Sandbox

Versión web reducida del experimento `llm_mqtt-local_robot`.

El objetivo de este proyecto es separar el **robot virtual + control cinemático + MQTT** del resto del stack de LLM, planeación y backend. El resultado es un sandbox estático que puede publicarse en cualquier servidor web.

## Funciones

- 100% HTML/CSS/JavaScript.
- No requiere Python, FastAPI ni Node.js para ejecutar la página.
- Entre 1 y 4 robots virtuales.
- Modelo cinemático tipo **uniciclo**:
  - `x_dot = v cos(theta)`
  - `y_dot = v sin(theta)`
  - `theta_dot = omega`
- Control de posición mediante un punto de extensión delante del robot.
- Cada robot se suscribe a un tópico MQTT configurable.
- Varios robots pueden compartir el mismo tópico para control tipo broadcast.
- Broker por defecto:
  - `wss://mqtt.mecatronica-ibero.mx/`
- Tópicos por defecto:
  - `public/robot-sandbox/robot1/goal`
  - `public/robot-sandbox/robot2/goal`
  - `public/robot-sandbox/robot3/goal`
  - `public/robot-sandbox/robot4/goal`
- El escenario es de `1000 x 600 mm`.

## Mensaje MQTT

Formato recomendado:

```json
{
  "x": 250,
  "y": -100
}
```

También se acepta:

```json
{
  "goal": {
    "x": 250,
    "y": -100
  }
}
```

Los objetivos se limitan automáticamente al área visible:

- `x`: -500 a 500 mm
- `y`: -300 a 300 mm

## Cómo ejecutar

No abras necesariamente el archivo con doble clic si tu navegador aplica restricciones a recursos locales. Lo más sencillo es servir la carpeta con HTTP.

Con Python:

```bash
python -m http.server 8000
```

Luego abre:

```text
http://localhost:8000
```

También puede desplegarse directamente en Nginx, Apache, GitHub Pages o cualquier hosting estático.

## Arquitectura

```text
Aplicación externa
Python / ESP32 / web / LLM / etc.
          |
          | publica {"x": ..., "y": ...}
          v
       MQTT Broker
          |
          | WSS / MQTT
          v
+----------------------------------+
| MQTT Robot Sandbox               |
|                                  |
| Robot 1 <- topic configurable    |
| Robot 2 <- topic configurable    |
| Robot 3 <- topic configurable    |
| Robot 4 <- topic configurable    |
|                                  |
| Cada robot ejecuta localmente:   |
| cinemática + control + render    |
+----------------------------------+
```

La simulación ocurre completamente en el navegador. El broker sólo transporta los objetivos.

## Control cinemático

Para cada robot se define un punto de control:

```text
x_e = x + l cos(theta)
y_e = y + l sin(theta)
```

El error cartesiano respecto al objetivo es:

```text
e_x = x_goal - x_e
e_y = y_goal - y_e
```

Se aplica control proporcional:

```text
u_x = k e_x
u_y = k e_y
```

y se transforma a velocidades del uniciclo:

```text
v     = cos(theta) u_x + sin(theta) u_y
omega = (-sin(theta) u_x + cos(theta) u_y) / l
```

## Ejemplo Python

En `examples/python_control.py` se incluye un cliente externo con Paho MQTT.

Instalación:

```bash
pip install paho-mqtt
```

Ejemplo:

```bash
python examples/python_control.py --robot 1 --x 200 --y 100
```

Para mover varios robots en secuencia:

```bash
python examples/python_control.py --demo
```

> El ejemplo usa MQTT con TLS por el puerto 8883. Si el broker requiere credenciales para el tópico elegido, usa `--username` y `--password`.

## Estructura

```text
mqtt_robot_sandbox/
├── index.html
├── styles.css
├── robot.js
├── app.js
├── README.md
└── examples/
    └── python_control.py
```

## Siguiente evolución posible

Esta V1 está pensada como sandbox mínimo. Sobre esta base se puede agregar después:

- tópico de telemetría por robot;
- orientación deseada;
- velocidades `v` / `omega` directas por MQTT;
- obstáculos;
- sensores virtuales;
- colisiones;
- robots diferenciales con parámetros físicos;
- planeadores externos;
- control multiagente;
- LLM como cliente MQTT externo.

La ventaja es que ninguna de esas funciones obliga a reincorporar un backend: pueden agregarse manteniendo el sandbox web como una plataforma independiente.
