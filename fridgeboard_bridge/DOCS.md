# FridgeBoard Bridge

Links this Home Assistant to your FridgeBoard.

- **Sensors and buttons do things on FridgeBoard.** A door sensor on the drawer where the lead lives can start the dog's walk, and end it next time it opens. A button by the food can mark a pet fed. A button on the pill bottle can mark a medicine given. A sensor or a button can tick a chore or a step in a routine.
- **Your lights and sensors on the shared screen.** Lights, switches, scenes, scripts and sensors go on Home as tiles. Swipe across a light to dim it, tap its icon to turn it on or off, or tap a scene to run it.
- **FridgeBoard tells Home Assistant what happened.** Each chore ticked, routine started or finished, walk, feed and medicine fires a `fridgeboard_event`, for your own automations.
- **Your automations can do things on FridgeBoard.** Give a medicine, tick a chore, a job or a routine step, add to any list, or put a message on the shared screens.

The bridge calls out to FridgeBoard. Nothing in your home is opened to the internet, and FridgeBoard never gets your Home Assistant address or a token. Only what you tick on this app's page is ever sent.

Step-by-step guides and ready-made blueprints: https://fridgeboard.me/home-assistant

## Setting it up

1. Start this app, then open **FridgeBoard** in the sidebar.
2. On your phone, open FridgeBoard, then **Settings › Home Assistant › Get a code**. Type the code into this app's page.
3. Tick what FridgeBoard may use: sensors and buttons that do something on FridgeBoard, and lights, switches, scenes, scripts and sensors for the shared screen. Nothing is ticked at first, and nothing unticked ever leaves your house.
4. Back on the phone, under **Settings › Home Assistant**:
   tap **+** by **When something happens** to say what a sensor or a button does.
5. On the shared screen, open **☰ › Arrange Home** and tap **+**. Under **Smart home**, add a Smart home card (fill its pages from its **⋯**) or any one thing on its own.

## On the shared screen

| Kind | On its tile |
| --- | --- |
| `light` that dims | swipe across to set the level, all the way down for off; its icon turns it on or off. A coloured bulb's tile shows its colour |
| `light` that doesn't dim, `switch`, `fan`, `input_boolean` | a tap turns it on or off |
| `scene`, `script`, `button`, `input_button` | a tap runs it |
| `sensor`, `binary_sensor` | it shows the reading (temperature, humidity, a door open or closed) |

A tile is 1 by 1, 2 by 1 or 1 by 2. A sensor's reading is sent at most once a minute. Locks, garage doors and alarms can't be tiles. Dimming needs version 0.3.0 of this app.

## When something happens on FridgeBoard

Every time something happens on FridgeBoard, it fires a `fridgeboard_event` here.

| type | data |
| --- | --- |
| `chore_done` | task, kind (chore or job), person, coins |
| `routine_started` | routine, person |
| `routine_finished` | routine, person, minutes |
| `walk_started` | pets, person |
| `walk_ended` | pets, minutes, person |
| `pet_fed` | pet, meal, person |
| `medicine_given` | medicine, for, person |

Every event also has `via`: the screen's name, `phone`, or `Home Assistant`. This app's page shows the last 20 with their data.

### In the automation editor

1. Go to **Settings › Automations & scenes**, tap **Create automation**, then **Create new automation**.
2. Tap **Add trigger**, search for **Manual event** and pick it.
3. In **Event type**, type `fridgeboard_event`.
4. In **Event data**, type what to match, one per line. For Ben finishing Bedtime:
   ```yaml
   type: routine_finished
   routine: Bedtime
   person: Ben
   ```
   Leave out a line to match any. Just `type: chore_done` fires for every chore.
5. Tap **Add action** and pick what happens, like **Light › Turn off**. Save it.

Or, in YAML:

```yaml
triggers:
  - trigger: event
    event_type: fridgeboard_event
    event_data: {type: routine_finished, person: Ben, routine: Bedtime}
actions:
  - action: light.turn_on
    target: {entity_id: light.hall}
```

The blueprint **FridgeBoard - when something happens** does the same with a form. Add it from https://fridgeboard.me/home-assistant.

## Asking FridgeBoard to do something

Your automations can ask FridgeBoard to do something by firing a `fridgeboard` event. In the editor: **Add action**, search for **Manual event**, Event type `fridgeboard`, and the data below.

| action | data | does |
| --- | --- | --- |
| `walk` | pet | starts the walk, or ends it if it's going |
| `walk_start`, `walk_end` | pet | just starts, or just ends |
| `feed` | pet | marks the pet fed |
| `medicine` | medicine, for (when two have the same name) | gives the dose due now |
| `chore` | task | ticks the chore |
| `job` | job | ticks a job (one with no set day) |
| `step` | routine, step, person (when each child has their own) | ticks a step in a routine |
| `shopping` | item | adds it to Shopping |
| `list` | list, item | adds it to that list (no list: Shopping) |
| `message` | text, screen, urgent | puts a message on the shared screens |
| `wake` | screen | wakes a screen from its sleep screen |

Add `person` to any of them to say who did it. Names are as FridgeBoard shows them, and capitals don't matter. Leave out `screen` for every screen. If a name isn't found, this app's page says so under Lately.

```yaml
actions:
  - event: fridgeboard
    event_data: {action: message, text: "The washing's done"}
  - event: fridgeboard
    event_data: {action: step, routine: Bedtime, step: Brush teeth, person: Ben}
```

The blueprint **FridgeBoard - message the shared screens** puts a message up when something changes, like the washing machine finishing.

### Only Home Assistant ticks it

A routine step can be set so only Home Assistant ticks it, not a tap on the shared screen: on the phone, open the routine, tap the step and turn on **Only Home Assistant ticks it**. An adult's phone can still put it right.

### By voice, with Assist

Home Assistant's voice assistant (Assist, on a phone or a Voice Preview Edition) can do the same with a sentence trigger. Add this automation, and say "add eggs to FridgeBoard" or "Max has been fed":

```yaml
alias: FridgeBoard by voice
triggers:
  - trigger: conversation
    command:
      - "add {item} to [the] fridgeboard"
      - "put {item} on [the] fridgeboard"
    id: shopping
  - trigger: conversation
    command:
      - "{pet} has been fed"
      - "[i] fed {pet}"
    id: feed
actions:
  - choose:
      - conditions: "{{ trigger.id == 'shopping' }}"
        sequence:
          - event: fridgeboard
            event_data: {action: shopping, item: "{{ trigger.slots.item }}"}
          - set_conversation_response: "Added {{ trigger.slots.item }} to Shopping"
      - conditions: "{{ trigger.id == 'feed' }}"
        sequence:
          - event: fridgeboard
            event_data: {action: feed, pet: "{{ trigger.slots.pet }}"}
          - set_conversation_response: "Done, {{ trigger.slots.pet }} is fed"
```

## The shared screen inside a dashboard

On a wall tablet that runs Home Assistant, a dashboard's **Webpage** card can show the shared screen beside your cameras and floor plan. On the phone, turn on **Settings › Home Assistant › Show inside a dashboard**, then add a Webpage card with the address `https://fridgeboard.me/board`. It shows a code the first time: connect it like any shared screen.

## Options

- **server**: leave as `https://fridgeboard.me`.
