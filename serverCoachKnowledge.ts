export interface CoachDirectAnswer {
  speaker: 'maya' | 'leo' | 'sam';
  reply: string;
  scienceConcept: string;
  actionTip: string;
  suggestedQuestions: string[];
}

interface TelemetrySummary {
  // Docking telemetry
  rangeMeters?: number;
  closureRateMs?: number;
  lateralOffsetM?: number;
  alignmentErrorDeg?: number;
  fuelRemainingPct?: number;
  dockingStatus?: string;
  activeDrills?: string[];
  // Outpost telemetry
  theater?: string;
  sol?: number;
  o2Pct?: number;
  co2MmHg?: number;
  pressureKpa?: number;
  batteryPct?: number;
  crewHealthPct?: number;
  insideTempC?: number;
  foodSols?: number;
  radiationMsv?: number;
  allocEclss?: number;
  allocShielding?: number;
  allocHydroponics?: number;
  allocThermal?: number;
  shelterActive?: boolean;
  hullIsolated?: boolean;
}

interface NasaSummary {
  spaceWeather?: {
    level?: string;
    latestCmeSpeedKms?: number;
    fastestCmeSpeedKms?: number;
    latestKpIndex?: number;
    recentCmeCount?: number;
  };
  marsWeather?: {
    sol?: string;
    avgTempC?: number;
    minTempC?: number;
    maxTempC?: number;
    pressureKpa?: number;
    windMs?: number;
  };
  asteroids?: Array<{
    name: string;
    diameterM: number;
    speedKmh: number;
    missKm: number;
    hazardous: boolean;
  }>;
}

export function buildDirectKidCoachAnswer(params: {
  question: string;
  callsign?: string;
  mode?: string;
  speaker: 'maya' | 'leo' | 'sam';
  telemetry?: TelemetrySummary | null;
  nasaFeed?: NasaSummary | null;
}): CoachDirectAnswer {
  const { question, callsign = 'Cadet', mode = 'general', speaker, telemetry, nasaFeed } = params;
  const q = question.toLowerCase().trim();
  const name = callsign || 'Cadet';

  const activeDrills = Array.isArray(telemetry?.activeDrills) ? telemetry.activeDrills : [];
  const topAsteroid = nasaFeed?.asteroids?.[0];
  const mars = nasaFeed?.marsWeather;
  const sw = nasaFeed?.spaceWeather;

  // 1) Active emergency alerts or direct simulator "what should I do / button / help" questions
  if (
    /\b(alert|emergency|drill|stuck|leak|meteor|flare|blackout|fix|what should i do|what do i do|help me|next step|right now|button|control)\b/.test(
      q
    )
  ) {
    if (mode === 'docking' && telemetry) {
      if (activeDrills.includes('RCS_STUCK_THRUSTER')) {
        return {
          speaker,
          reply:
            'A side thruster valve is stuck firing and pushing your shuttle sideways! Tap the Fix Alert wrench button or tap opposite Steer arrows right away, and tap Brake to stay slow.',
          scienceConcept:
            'Action and reaction forces keep pushing you sideways in space unless an equal opposite jet cancels them out.',
          actionTip: 'Tap Fix Alert or steer the opposite direction and tap Brake.',
          suggestedQuestions: [
            'Why does a stuck jet push me sideways?',
            'How do I dock gently?',
            'Why do astronauts float?',
          ],
        };
      }
      if ((telemetry.closureRateMs ?? 0) > 0.35) {
        return {
          speaker,
          reply: `Right now you are closing in a little fast at ${Number(telemetry.closureRateMs).toFixed(2)} meters per second, ${name}. Tap the Brake button or press Spacebar to fire nose jets and slow down safely!`,
          scienceConcept:
            'Momentum equals mass times speed, so heavy spacecraft need early braking to dock softly.',
          actionTip: 'Tap Brake (Spacebar) until your speed indicator turns green.',
          suggestedQuestions: [
            'Why does my shuttle keep gliding after W?',
            'How do thrusters push in empty space?',
            'Why is Mars red?',
          ],
        };
      }
      if ((telemetry.lateralOffsetM ?? 0) > 0.55) {
        return {
          speaker,
          reply: `You are ${Number(telemetry.lateralOffsetM).toFixed(1)} meters off-center from the docking ring, ${name}. Tap the Up, Down, Left, or Right steer arrows—or tap Auto-Aim—to line your nose right into the green rings!`,
          scienceConcept:
            'Side thrusters push gas in the opposite direction to slide your nose cleanly along three axes.',
          actionTip: 'Tap Auto-Aim or gently nudge steer arrows toward the green ring.',
          suggestedQuestions: [
            'How does hovering turn my ship?',
            'Why do astronauts dock so slowly?',
            'How big is the Sun?',
          ],
        };
      }
      return {
        speaker,
        reply: `You are looking steady ${Number(telemetry.rangeMeters ?? 18).toFixed(0)} meters out with ${telemetry.fuelRemainingPct ?? 90} percent fuel left! Use tiny taps on Forward or W to glide in, steer with the arrows or hover turns, and tap Brake near the ring.`,
        scienceConcept:
          'In zero-gravity vacuum there is no air friction, so small thruster taps carry you smoothly.',
        actionTip: 'Hover or tap steer arrows to stay centered inside the green target rings.',
        suggestedQuestions: [
          'Why does my shuttle keep gliding after W?',
          'How do I use hover turn?',
          'What is NASA seeing in space today?',
        ],
      };
    }

    if ((mode === 'lunar_outpost' || mode === 'mars_outpost') && telemetry) {
      if (activeDrills.includes('HULL_MICROMETEOROID') && !telemetry.hullIsolated) {
        return {
          speaker,
          reply:
            'A tiny space rock poked a pinhole leak in the outer dome! Tap Close Safety Door right away to seal that room and keep breathable air pressure safe inside.',
          scienceConcept:
            'Air rushes from high dome pressure out into empty space vacuum unless airtight bulkheads seal the room.',
          actionTip: 'Tap Close Safety Door immediately, then check Air Maker.',
          suggestedQuestions: [
            'How does Air Maker turn water into oxygen?',
            'Why is Mars air so thin and cold?',
            'What happens in the vacuum of space?',
          ],
        };
      }
      if (activeDrills.includes('SOLAR_FLARE_SPE') && !telemetry.shelterActive) {
        return {
          speaker,
          reply:
            'A solar particle storm is hitting outside right now! Tap Storm Shelter and turn up your Space Shield slider so thick water and soil walls block the rays.',
          scienceConcept:
            'Water walls and lunar or Martian soil absorb fast solar flare particles before they harm astronauts.',
          actionTip: 'Tap Storm Shelter and slide Space Shield up.',
          suggestedQuestions: [
            'How do Storm Shelters block solar rays?',
            'What is a solar flare?',
            'What is NASA seeing in space today?',
          ],
        };
      }
      if ((telemetry.o2Pct ?? 21) < 19.5) {
        return {
          speaker,
          reply: `Fresh air oxygen has dipped to ${telemetry.o2Pct} percent! Tap the Plus button on Air Maker so electricity can split water into fresh breathable oxygen.`,
          scienceConcept:
            'Electrolysis splits water molecules (H2O) into oxygen for breathing and hydrogen.',
          actionTip: 'Turn up the Air Maker slider above 14 kW.',
          suggestedQuestions: [
            'How do plants help our crew breathe?',
            'How does Air Maker keep oxygen safe?',
            'Why is Mars air so thin?',
          ],
        };
      }
      return {
        speaker,
        reply: `Your ${mode === 'mars_outpost' ? 'Mars' : 'Moon'} Base sensors look healthy with ${telemetry.crewHealthPct ?? 98} percent crew health and ${telemetry.batteryPct ?? 80} percent battery! Keep Air Maker, Space Shield, Space Farm, and Water Saver balanced below your green power supply bar.`,
        scienceConcept:
          'Space habitats recycle air, water, and electricity in a closed loop because resupply ships take months.',
        actionTip: 'Try tapping Grow Food or Storm Shield mode to watch your habitat respond.',
        suggestedQuestions: [
          'How do plants help our crew breathe?',
          'Why is Mars air so thin and cold?',
          'What is a black hole?',
        ],
      };
    }
  }

  // 2) Hover / rotate / touch / camera / steering controls
  if (/\b(hover|rotate|spin|turn around|camera|swipe|touch screen|angle|360)\b/.test(q)) {
    return {
      speaker,
      reply:
        'Great flying tip! Slide your finger or move near the edges of the screen to smoothly rotate 360 degrees around your spacecraft or base and aim your camera view anywhere.',
      scienceConcept:
        'Real spacecraft rotate in three dimensions using small reaction control jets and spinning gyroscopes.',
      actionTip: 'Make sure Hover Turn is set to On, then gently glide your finger across the 3D scene.',
      suggestedQuestions: [
        'How do thrusters push in empty space?',
        'How do I dock gently?',
        'Why do astronauts float?',
      ],
    };
  }

  // 3) Live NASA Weather / Solar Storms / Today in Space / Asteroids
  if (/\b(nasa|today|weather|solar storm|flare|cme|space weather|asteroid|meteor|kp index|sun storm)\b/.test(q)) {
    const cmeSpeed = sw?.fastestCmeSpeedKms ?? 974;
    const level = sw?.level ?? 'ACTIVE';
    const kp = sw?.latestKpIndex ?? 3;
    const astLine = topAsteroid
      ? ` NASA is also tracking asteroid ${topAsteroid.name}, about ${topAsteroid.diameterM} meters wide, zooming harmlessly past Earth at ${topAsteroid.speedKmh.toLocaleString()} kilometers per hour.`
      : '';
    return {
      speaker,
      reply: `Right now NASA space weather is at ${level} status with solar wind waves up to ${cmeSpeed} kilometers per second and Earth magnetic Kp index ${kp}.${astLine}`,
      scienceConcept:
        'Coronal mass ejections are giant bursts of magnetic gas launched by the Sun that cause bright northern auroras.',
      actionTip: 'Turn up Space Shield in the Moon or Mars Base when space weather rises!',
      suggestedQuestions: [
        'How do Storm Shelters block solar rays?',
        'Why is Mars red?',
        'How big is the Sun?',
      ],
    };
  }

  // 4) Why is Mars red / Mars temperature / Mars atmosphere / Rovers
  if (/\b(mars|red planet|red crater|rover|perseverance|curiosity|olympus mons|dust storm)\b/.test(q)) {
    const temp = mars?.avgTempC ?? -62.4;
    const press = mars?.pressureKpa ?? 0.74;
    if (/\b(cold|air|thin|breathe|atmosphere|weather|temp)\b/.test(q)) {
      return {
        speaker,
        reply: `Mars has super thin carbon dioxide air—under one percent of Earth's air pressure (${press} kPa)—so there is no thick blanket to hold heat! NASA InSight measured chilly average days around ${temp} degrees Celsius.`,
        scienceConcept:
          'Thin atmospheres cannot trap daytime sunlight warmth, causing huge freezing temperature drops every Martian night.',
        actionTip: 'Keep Water & Heater Saver powered up when running the Mars Base!',
        suggestedQuestions: [
          'Why is Mars red?',
          'Could plants grow on Mars?',
          'How long does it take to fly to Mars?',
        ],
      };
    }
    return {
      speaker,
      reply: `Mars looks bright rusty red because its rocks and powdery dirt are packed with iron oxide—the exact same mineral that makes an old bicycle turn rusty! Wind whips that fine red dust high into the sky too.`,
      scienceConcept:
        `Iron on Mars combined with oxygen billions of years ago to coat the planet in rust, where temperatures average ${temp}°C today.`,
      actionTip: 'Fly the Mars Base simulator and watch our rover explore Red Crater!',
      suggestedQuestions: [
        'Why is Mars air so thin and cold?',
        'How long does it take to fly to Mars?',
        'Are there volcanoes on Mars?',
      ],
    };
  }

  // 5) Shuttle gliding / Inertia / Momentum / Why dock slowly
  if (/\b(glid|inertia|keep moving|after w|slowly|slow down|momentum|friction|newton)\b/.test(q)) {
    return {
      speaker,
      reply:
        'On Earth, air and tire friction stop a rolling scooter fast, but space is an almost empty vacuum! Because of inertia—Newton’s First Law—your shuttle keeps gliding at the exact same speed until a brake thruster pushes backward.',
      scienceConcept:
        'Even weightless ships have heavy mass, so astronauts dock slower than walking speed to avoid a hard bounce.',
      actionTip: 'Give tiny taps on Forward (W), then tap Brake (Spacebar) early as you near the rings!',
      suggestedQuestions: [
        'How do thrusters push in empty space?',
        'Why do astronauts float?',
        'What is a black hole?',
      ],
    };
  }

  // 6) Thrusters / Rockets / How rockets push in empty space (no air to push off)
  if (/\b(thruster|rocket|push|empty space|jet|propel|launch|blast off|escape|fuel)\b/.test(q)) {
    return {
      speaker,
      reply:
        'Rockets do not need air to push against! When a thruster blasts gas out one side, Newton’s Third Law says an equal push shoves the shuttle the opposite way—just like letting go of an inflated balloon and watching it zip across a room!',
      scienceConcept:
        'Every push creates an equal and opposite push back, which works even better in the vacuum of space.',
      actionTip: 'Tap Steer Left or Right in Docking and watch white gas jets fire on the opposite side!',
      suggestedQuestions: [
        'Why does my shuttle keep gliding after W?',
        'How fast do rockets go?',
        'Why is Mars red?',
      ],
    };
  }

  // 7) Why astronauts float / Gravity / Orbits / ISS
  if (/\b(float|gravity|zero g|weightless|orbit|space station|iss|fall around)\b/.test(q)) {
    return {
      speaker,
      reply:
        'Surprisingly, Earth’s gravity is still pulling strongly on the Space Station! Astronauts float because their station is zipping sideways at 28,000 kilometers per hour, constantly falling around curved Earth together—like being on a non-stop roller coaster drop!',
      scienceConcept:
        'Orbital free-fall means both the spaceship and the astronauts fall together at the exact same speed, creating floating microgravity.',
      actionTip: 'Imagine throwing a ball so fast it curves right around Earth—that is an orbit!',
      suggestedQuestions: [
        'How fast does the Space Station go?',
        'Why do spaceships keep drifting in space?',
        'Why do footprints stay on the Moon?',
      ],
    };
  }

  // 8) Air Maker / Oxygen / Plants / Water / Hydroponics
  if (/\b(oxygen|air maker|water|eclss|plant|farm|hydroponic|breathe|co2|carbon dioxide|food)\b/.test(q)) {
    return {
      speaker,
      reply:
        'Our Air Maker uses electricity to split water molecules into fresh oxygen gas for astronauts to breathe and hydrogen! Meanwhile, green Space Farm plants drink the carbon dioxide astronauts breathe out and release clean oxygen back into the dome.',
      scienceConcept:
        'Splitting water is called electrolysis, and plants turn CO2 plus grow-light energy into oxygen and fresh veggies.',
      actionTip: 'Try tapping Grow Food in the Moon or Mars Base and watch oxygen and food days climb!',
      suggestedQuestions: [
        'How do Storm Shelters block solar rays?',
        'Why is Mars air so thin and cold?',
        'What do astronauts eat in space?',
      ],
    };
  }

  // 9) Moon craters / Moon ice / Artemis / Footprints / Why is the Moon bright
  if (/\b(moon|lunar|crater|artemis|footprint|tide|shine|phases|eclipse)\b/.test(q)) {
    return {
      speaker,
      reply:
        'The Moon does not make its own light—it glows like a giant mirror reflecting sunlight back to Earth! NASA Artemis astronauts are aiming for the Moon’s South Pole because deep shady craters hide frozen water ice we can turn into drinking water, oxygen, and rocket fuel.',
      scienceConcept:
        'With no wind or rain on the Moon, asteroid craters and astronaut bootprints stay preserved for millions of years.',
      actionTip: 'Visit the Moon Base simulator to manage solar power, oxygen, and shelter shields!',
      suggestedQuestions: [
        'Why do astronauts float?',
        'Why does the Moon look different shapes?',
        'What is a black hole?',
      ],
    };
  }

  // 10) Black holes
  if (/\b(black hole|event horizon|spaghett|singularity|wormhole)\b/.test(q)) {
    return {
      speaker,
      reply:
        'A black hole is a super-dense spot left behind when a giant star collapses, packing enormous mass into a tiny space! Its gravity pulls so strongly that once anything crosses the edge called the event horizon—even a beam of light—it cannot escape back out.',
      scienceConcept:
        'Astronomers spot invisible black holes by watching nearby glowing gas swirl rapidly around them like water down a drain.',
      actionTip: 'Don’t worry—Earth is nowhere near any black hole; the closest known one is over 1,500 light-years away!',
      suggestedQuestions: [
        'How are stars born?',
        'What is the Milky Way galaxy?',
        'How big is the Sun?',
      ],
    };
  }

  // 11) Sun / Stars / Constellations / Galaxies / Universe
  if (/\b(sun|star|constellation|galaxy|milky way|universe|big bang|light year|supernova)\b/.test(q)) {
    return {
      speaker,
      reply:
        'Our Sun is actually a giant glowing ball of super-hot gas—a medium-sized star—so big that about one million Earths could fit inside it! Every single second, its core fuses hydrogen into helium, beaming out light and heat across our whole solar system.',
      scienceConcept:
        'Our Sun is just one of over 100 billion stars spinning together inside the Milky Way spiral galaxy.',
      actionTip: 'Check NASA Space Weather in the Lounge to watch real bursts of energy from the Sun today!',
      suggestedQuestions: [
        'What is a black hole?',
        'Why is the sky blue?',
        'What is NASA seeing in space today?',
      ],
    };
  }

  // 12) Other Planets: Jupiter, Saturn, Venus, Mercury, Uranus, Neptune, Pluto
  if (/\b(jupiter|saturn|venus|mercury|uranus|neptune|pluto|rings|planet|solar system)\b/.test(q)) {
    if (/saturn/.test(q)) {
      return {
        speaker,
        reply:
          'Saturn’s famous sparkling rings are not solid at all—they are made of billions of chunks of water ice and rocky dust orbiting together, from tiny snow grains to house-sized icebergs!',
        scienceConcept:
          'Saturn is such a light gas giant that if you had a bathtub big enough, Saturn would actually float in water.',
        actionTip: 'Ask about Jupiter, Venus, or how long it takes to reach Mars next!',
        suggestedQuestions: ['How big is Jupiter?', 'Why is Venus hotter than Mercury?', 'Why is Mars red?'],
      };
    }
    if (/jupiter/.test(q)) {
      return {
        speaker,
        reply:
          'Jupiter is the king of planets—more than twice as heavy as all our other planets combined! Its Great Red Spot is a swirling hurricane storm bigger than our entire planet Earth that has been raging for hundreds of years.',
        scienceConcept:
          'Jupiter spins super fast—one whole day on Jupiter lasts less than ten Earth hours!',
        actionTip: 'Explore how gravity helps spacecraft slingshot past giant planets!',
        suggestedQuestions: ['What are Saturn’s rings made of?', 'Why is Mars red?', 'What is a black hole?'],
      };
    }
    if (/venus|mercury/.test(q)) {
      return {
        speaker,
        reply:
          'Even though Mercury is closest to the Sun, Venus is actually the hottest planet at 465 degrees Celsius! Venus is wrapped in thick carbon dioxide clouds that trap sunlight heat like a giant parked car in summer.',
        scienceConcept:
          'This super-strong greenhouse effect makes Venus hot enough to melt lead day and night.',
        actionTip: 'Notice how managing CO2 in our Space Base keeps dome temperatures steady!',
        suggestedQuestions: ['Why is Mars air so thin and cold?', 'How big is the Sun?', 'What are Saturn’s rings made of?'],
      };
    }
    if (/pluto|uranus|neptune/.test(q)) {
      return {
        speaker,
        reply:
          'Way out at the icy edge of our solar system, blue Neptune whips up supersonic winds faster than a fighter jet, and dwarf planet Pluto has a giant heart-shaped glacier made of frozen nitrogen ice!',
        scienceConcept:
          'Because Uranus tilts completely on its side like a rolling barrel, its poles get 42 straight years of sunlight and 42 years of darkness.',
        actionTip: 'Ask about black holes, Saturn’s rings, or how rockets escape Earth!',
        suggestedQuestions: ['What are Saturn’s rings made of?', 'How big is Jupiter?', 'What is a black hole?'],
      };
    }
    return {
      speaker,
      reply:
        'Our solar system has eight main planets orbiting the Sun: four rocky inner worlds—Mercury, Venus, Earth, and Mars—followed by huge gas and ice giants—Jupiter, Saturn, Uranus, and Neptune!',
      scienceConcept:
        'A fun memory trick in order from the Sun is: My Very Educated Mother Just Served Us Noodles.',
      actionTip: 'Pick any planet name and ask me a secret fact about it!',
      suggestedQuestions: ['Why is Mars red?', 'What are Saturn’s rings made of?', 'How big is Jupiter?'],
    };
  }

  // 13) Astronaut life: spacesuits, eating, sleeping, sound in space, sky blue, aliens
  if (/\b(suit|helmet|eat|sleep|sound|hear|sky blue|alien|life|time|how long|how fast)\b/.test(q)) {
    if (/sound|hear/.test(q)) {
      return {
        speaker,
        reply:
          'You cannot hear sounds in open space because sound travels as waves bumping through air molecules, and space is an empty vacuum! Inside your spacecraft or helmet air, sound waves travel normally—which is why astronauts talk using radio waves.',
        scienceConcept:
          'Radio waves are invisible light waves, so they zip cleanly across empty space at the speed of light!',
        actionTip: 'Keep your telemetry and AI Coach radio voices on while flying!',
        suggestedQuestions: ['Why do astronauts float?', 'Why is the sky blue?', 'Why is Mars red?'],
      };
    }
    if (/sky blue/.test(q)) {
      return {
        speaker,
        reply:
          'Sunlight actually contains every color of the rainbow mixed together! When sunlight hits Earth’s air molecules, short blue light waves bounce and scatter across the whole sky—while astronauts in space see pitch-black skies even at noon!',
        scienceConcept:
          'Because Mars has dusty iron-rich skies instead of thick Earth nitrogen, Martian sunsets glow cool dusty blue!',
        actionTip: 'Notice the crisp black sky and glowing blue Earth horizon in our Docking 3D view!',
        suggestedQuestions: ['Why is Mars red?', 'What happens in the vacuum of space?', 'How big is the Sun?'],
      };
    }
    if (/alien|life/.test(q)) {
      return {
        speaker,
        reply:
          'Scientists have not found space aliens yet, but NASA rovers on Mars and space telescopes like James Webb are hunting for signs of tiny ancient microbes and watery planets around distant stars! Finding even microscopic alien life would be the biggest discovery ever.',
        scienceConcept:
          'Wherever liquid water and energy exist—even under icy moons like Europa and Enceladus—life might have a chance.',
        actionTip: 'Keep your Moon & Mars Base life-support green to see everything living things need!',
        suggestedQuestions: ['Why is Mars air so thin and cold?', 'How do plants help our crew breathe?', 'What is a black hole?'],
      };
    }
    if (/how long|mars/.test(q)) {
      return {
        speaker,
        reply:
          'Flying to the Moon takes about three days on an Artemis rocket, while flying all the way to Mars takes roughly six to nine months! That is why NASA waits until Earth and Mars line up closest on the same side of the Sun.',
        scienceConcept:
          'Spacecraft follow an energy-saving curved path called a Hohmann transfer orbit instead of a straight line.',
        actionTip: 'Ready to practice orbital maneuvers right here in Space Docking?',
        suggestedQuestions: ['How fast do rockets go?', 'Why is Mars red?', 'Why do astronauts float?'],
      };
    }
    return {
      speaker,
      reply:
        'A spacesuit is basically a personal mini-spaceship shaped like a person! It holds warm pressurized oxygen, cools astronauts with tiny water tubes, shields against bright sunlight, and lets them sleep clipped in floating sleeping bags inside the station.',
      scienceConcept:
        'Without a pressurized helmet in space vacuum, air would rush out and space is freezing in shadow or boiling in direct sun.',
      actionTip: 'Check Air Maker and Storm Shield in our Moon Base to run real spacesuit and dome life-support!',
      suggestedQuestions: [
        'How does Air Maker turn water into oxygen?',
        'Can you hear sound in space?',
        'Why do astronauts float?',
      ],
    };
  }

  // 14) Greeting / Who are you / Friendly intro
  if (/^(hi|hello|hey|yo|good morning|good afternoon|who are you|what is your name|thank)/.test(q)) {
    const coachTitle =
      speaker === 'leo' ? 'Pilot Leo' : speaker === 'sam' ? 'Flight Director Sam' : 'Commander Maya';
    return {
      speaker,
      reply: `Hi ${name}! I am ${coachTitle}, ready to fly and explore science with you anytime. Ask me any question at all—about your ship controls, black holes, Mars, rockets, or how astronauts live in space!`,
      scienceConcept:
        'Every real NASA mission pairs astronauts in the cockpit with flight coaches on Earth working together as one team.',
      actionTip: 'Type anything you are curious about below, or tap any quick question!',
      suggestedQuestions: [
        'Why is Mars red?',
        'Why do astronauts float?',
        'What should I do right now?',
      ],
    };
  }

  // 15) General fallback that STILL answers warmly & directly without giving an error
  return {
    speaker,
    reply: `Great question, ${name}! While exploring "${question.trim().slice(0, 80)}", remember that space works on clear physics rules: motion continues smoothly in zero gravity unless thrusters push back, and every habitat needs balanced air, water, heat, and shielding!`,
    scienceConcept:
      'In spaceflight, curious questions lead straight to real experiments—just like NASA astronauts test aboard the station.',
    actionTip: 'Ask me specifically about any planet, rocket control, black hole, or your live flight numbers!',
    suggestedQuestions: [
      'What should I do right now?',
      'Why do spaceships keep drifting in space?',
      'What is NASA seeing in space today?',
    ],
  };
}
