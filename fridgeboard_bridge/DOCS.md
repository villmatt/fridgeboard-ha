# FridgeBoard Bridge

Links this Home Assistant to your FridgeBoard.

- **Sensors and buttons do things on FridgeBoard.** A door sensor on the drawer where the lead lives can start the dog's walk, and end it next time it opens. A button by the food can mark a pet fed. A button can tick a chore.
- **FridgeBoard tells Home Assistant what happened.** Each chore ticked, routine started or finished, walk, feed and medicine fires a `fridgeboard_event`, for your own automations.

The bridge calls out to FridgeBoard. Nothing in your home is opened to the internet, and FridgeBoard never gets your Home Assistant address or a token.

## Setting it up

1. Start this add-on, then open **FridgeBoard** in the sidebar.
2. On your phone, open FridgeBoard, then **Settings › Home Assistant › Get a code**. Type the code into the add-on's page.
3. Tick the sensors, buttons and switches FridgeBoard may use. Nothing is ticked at first, and nothing unticked ever leaves your house.
4. Back on the phone, under **Home Assistant**, tap **+** to say what each one does.

## Automations

Trigger on the `fridgeboard_event` event and match on its data:

```yaml
trigger:
  - platform: event
    event_type: fridgeboard_event
    event_data: {type: routine_finished, person: Ben, routine: Bedtime}
action:
  - service: light.turn_on
    target: {entity_id: light.hall}
```

| type | data |
| --- | --- |
| `chore_done` | task, kind (chore or job), person, coins |
| `routine_started` | routine, person |
| `routine_finished` | routine, person, minutes |
| `walk_started` | pets, person |
| `walk_ended` | pets, minutes, person |
| `pet_fed` | pet, meal, person |
| `medicine_given` | medicine, for, person |

Every event also has `via`: the screen's name, `phone`, or `Home Assistant`. The add-on's page shows the last 20 with their data.

Your automations can also ask FridgeBoard to do something, by firing a `fridgeboard` event:

```yaml
action:
  - event: fridgeboard
    event_data: {action: walk, pet: Max}   # walk, walk_start, walk_end, feed, chore (task, person), shopping (item)
```

## Options

- **server**: leave as `https://fridgeboard.me`.
