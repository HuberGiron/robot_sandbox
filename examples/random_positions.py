#!/usr/bin/env python3

"""Publica posiciones aleatorias para un robot cada cierto intervalo."""

import argparse
import json
import random
import ssl
import time

import paho.mqtt.client as mqtt

BROKER = "mqtt.mecatronica-ibero.mx"
PORT = 443
TOPIC_TEMPLATE = "public/robot-sandbox/robot{robot}/goal"


def build_client():
    try:
        client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=f"robot-random-{int(time.time())}",
            transport="websockets",
        )
    except (AttributeError, TypeError):
        client = mqtt.Client(
            client_id=f"robot-random-{int(time.time())}",
            transport="websockets",
        )

    client.ws_set_options(path="/")
    client.tls_set(cert_reqs=ssl.CERT_REQUIRED)
    return client


def main():
    parser = argparse.ArgumentParser(description="Objetivos aleatorios para un robot")
    parser.add_argument("--robot", type=int, choices=range(1, 5), default=1)
    parser.add_argument("--interval", type=float, default=10.0, help="Segundos entre publicaciones")
    parser.add_argument("--xmin", type=float, default=-400.0)
    parser.add_argument("--xmax", type=float, default=400.0)
    parser.add_argument("--ymin", type=float, default=-220.0)
    parser.add_argument("--ymax", type=float, default=220.0)
    args = parser.parse_args()

    if args.interval <= 0:
        raise SystemExit("--interval debe ser mayor que 0")
    if args.xmin >= args.xmax or args.ymin >= args.ymax:
        raise SystemExit("Los límites mínimos deben ser menores que los máximos")

    topic = TOPIC_TEMPLATE.format(robot=args.robot)
    client = build_client()

    print(f"Conectando a wss://{BROKER}/ ...")
    client.connect(BROKER, PORT, keepalive=30)
    client.loop_start()
    time.sleep(0.8)

    print(f"Publicando en {topic} cada {args.interval:g} s. Ctrl+C para detener.")

    try:
        while True:
            x = random.uniform(args.xmin, args.xmax)
            y = random.uniform(args.ymin, args.ymax)
            payload = json.dumps({"x": round(x, 2), "y": round(y, 2)})
            info = client.publish(topic, payload, qos=0, retain=False)
            info.wait_for_publish()
            print(f"-> {payload}")
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("\nDetenido por usuario.")
    finally:
        client.loop_stop()
        client.disconnect()


if __name__ == "__main__":
    main()
