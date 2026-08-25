#!/usr/bin/env python3

"""Cliente externo de ejemplo para MQTT Robot Sandbox."""

import argparse
import json
import ssl
import time

import paho.mqtt.client as mqtt


BROKER = "mqtt.mecatronica-ibero.mx"
PORT = 8883
TOPIC_TEMPLATE = "public/robot-sandbox/robot{robot}/goal"


def build_client(username=None, password=None):
    try:
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    except AttributeError:
        client = mqtt.Client()

    client.tls_set(cert_reqs=ssl.CERT_REQUIRED)

    if username:
        client.username_pw_set(username, password or "")

    return client


def publish_goal(client, robot, x, y):
    topic = TOPIC_TEMPLATE.format(robot=robot)
    payload = json.dumps({"x": float(x), "y": float(y)})
    result = client.publish(topic, payload, qos=0, retain=False)
    result.wait_for_publish()
    print(f"R{robot} -> {topic}: {payload}")


def run_demo(client):
    steps = [
        [(1, -150,  180), (2, -150, -180), (3, 150, 180), (4, 150, -180)],
        [(1,  250,  150), (2,  250, -150), (3,-250, 150), (4,-250, -150)],
        [(1,    0,    0), (2,    0,    0), (3,   0,   0), (4,   0,    0)],
    ]

    for n, goals in enumerate(steps, start=1):
        print(f"\nPaso {n}")
        for robot, x, y in goals:
            publish_goal(client, robot, x, y)
        if n < len(steps):
            time.sleep(5)


def main():
    parser = argparse.ArgumentParser(description="Control externo del MQTT Robot Sandbox")
    parser.add_argument("--robot", type=int, choices=range(1, 5), default=1)
    parser.add_argument("--x", type=float, default=0.0)
    parser.add_argument("--y", type=float, default=0.0)
    parser.add_argument("--username")
    parser.add_argument("--password")
    parser.add_argument("--demo", action="store_true")
    args = parser.parse_args()

    client = build_client(args.username, args.password)

    print(f"Conectando a mqtts://{BROKER}:{PORT} ...")
    client.connect(BROKER, PORT, keepalive=30)
    client.loop_start()

    try:
        # Pequeña espera para completar CONNECT antes de publicar.
        time.sleep(0.5)
        if args.demo:
            run_demo(client)
        else:
            publish_goal(client, args.robot, args.x, args.y)
    finally:
        time.sleep(0.2)
        client.loop_stop()
        client.disconnect()


if __name__ == "__main__":
    main()
