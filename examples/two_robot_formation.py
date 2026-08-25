#!/usr/bin/env python3

"""Control de dos robots en formación mediante objetivos MQTT.

R1 actúa como líder. R2 recibe la misma referencia con un offset fijo
(offset_x, offset_y) en coordenadas globales.

Por defecto el líder recorre un círculo y el seguidor mantiene el offset.
"""

import argparse
import json
import math
import ssl
import time

import paho.mqtt.client as mqtt

BROKER = "mqtt.mecatronica-ibero.mx"
PORT = 443
TOPIC_R1 = "public/robot-sandbox/robot1/goal"
TOPIC_R2 = "public/robot-sandbox/robot2/goal"


def build_client():
    try:
        client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=f"robot-formation-{int(time.time())}",
            transport="websockets",
        )
    except (AttributeError, TypeError):
        client = mqtt.Client(
            client_id=f"robot-formation-{int(time.time())}",
            transport="websockets",
        )

    client.ws_set_options(path="/")
    client.tls_set(cert_reqs=ssl.CERT_REQUIRED)
    return client


def publish(client, topic, x, y):
    payload = json.dumps({"x": round(x, 2), "y": round(y, 2)})
    info = client.publish(topic, payload, qos=0, retain=False)
    info.wait_for_publish()
    return payload


def main():
    parser = argparse.ArgumentParser(description="Formación de dos robots con offset fijo")
    parser.add_argument("--cx", type=float, default=0.0)
    parser.add_argument("--cy", type=float, default=0.0)
    parser.add_argument("--radius", type=float, default=160.0)
    parser.add_argument("--period", type=float, default=24.0)
    parser.add_argument("--interval", type=float, default=1.0)
    parser.add_argument("--offset-x", type=float, default=0.0, help="Offset global X de R2 respecto a R1")
    parser.add_argument("--offset-y", type=float, default=-120.0, help="Offset global Y de R2 respecto a R1")
    parser.add_argument("--loops", type=int, default=0, help="0 = infinito")
    args = parser.parse_args()

    if args.radius <= 0 or args.period <= 0 or args.interval <= 0:
        raise SystemExit("radius, period e interval deben ser mayores que 0")

    client = build_client()
    print(f"Conectando a wss://{BROKER}/ ...")
    client.connect(BROKER, PORT, keepalive=30)
    client.loop_start()
    time.sleep(0.8)

    omega = 2.0 * math.pi / args.period
    start = time.monotonic()
    last_index = -1

    print(
        f"Formación R1-R2: offset=({args.offset_x:g}, {args.offset_y:g}) mm, "
        f"círculo radio={args.radius:g} mm, periodo={args.period:g} s"
    )
    print("Habilita R1 y R2 en el sandbox. Ctrl+C para detener.")

    try:
        while True:
            elapsed = time.monotonic() - start
            index = int(elapsed / args.interval)
            if index == last_index:
                time.sleep(0.02)
                continue
            last_index = index

            t = index * args.interval
            if args.loops > 0 and t >= args.loops * args.period:
                break

            angle = omega * t
            x1 = args.cx + args.radius * math.cos(angle)
            y1 = args.cy + args.radius * math.sin(angle)

            x2 = x1 + args.offset_x
            y2 = y1 + args.offset_y

            p1 = publish(client, TOPIC_R1, x1, y1)
            p2 = publish(client, TOPIC_R2, x2, y2)

            print(f"t={t:6.1f}s  R1 {p1}   R2 {p2}")
    except KeyboardInterrupt:
        print("\nDetenido por usuario.")
    finally:
        client.loop_stop()
        client.disconnect()


if __name__ == "__main__":
    main()
