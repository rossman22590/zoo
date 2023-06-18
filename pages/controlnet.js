import { useState, useEffect } from "react";
import ControlnetPrediction from "../components/controlnet-prediction";
import Popup from "../components/popup";
import ZooHead from "../components/zoo-head";
import ExternalLink from "../components/external-link";
import promptmaker from "promptmaker";
import Link from "next/link";
import MODELS from "../lib/controlnetModels";
import { v4 as uuidv4 } from "uuid";
import { useRouter } from "next/router";
import slugify from "slugify";
import { FileUploader } from "react-drag-drop-files";
import { createClient } from "@supabase/supabase-js";
import seeds from "../lib/controlnetSeeds.js";
import { XCircleIcon, PhotoIcon } from "@heroicons/react/20/solid";
import Pills from "../components/pills";
import { InformationCircleIcon } from "@heroicons/react/20/solid";

// Create a single supabase client for interacting with your database
const supabase = createClient(
  "https://ennwjiitmiqwdrgxkevm.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVubndqaWl0bWlxd2RyZ3hrZXZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE2ODM5Mjc3OTgsImV4cCI6MTk5OTUwMzc5OH0.zCHzwchIjcmKNmccb9D4OLVwrWrpLHMmf4a8W7UedFs"
);

const supabaseUrl = "https://ennwjiitmiqwdrgxkevm.supabase.co";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fileTypes = ["JPG", "PNG"];

export default function Home({ baseUrl, submissionPredictions }) {
  const router = useRouter();
  const { id } = router.query;
  const [prompt, setPrompt] = useState("");
  const [imageFile, setImageFile] = useState(null);
  const [imageURL, setImageURL] = useState("");
  const [predictions, setPredictions] = useState([]);
  const [error, setError] = useState(null);
  const [numOutputs, setNumOutputs] = useState(3);
  const [firstTime, setFirstTime] = useState(false);
  const [models, setModels] = useState([]);
  const [anonId, setAnonId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [numRuns, setNumRuns] = useState(1);
  const [popupOpen, setPopupOpen] = useState(true);

  async function getPredictionsFromSeed(seed) {
    const response = await fetch(`/api/submissions/${seed}`, {
      method: "GET",
    });
    submissionPredictions = await response.json();
    setPredictions(submissionPredictions);

    // get the model names from the predictions, and update which ones are checked
    const modelNames = getModelsFromPredictions(submissionPredictions);
    updateCheckedModels(modelNames);

    // get the prompt from the predictions, and update the prompt
    const submissionPrompt = getPromptFromPredictions(submissionPredictions);
    setPrompt(submissionPrompt);

    const submissionImage = getImageFromPredictions(submissionPredictions);
    setImageURL(submissionImage);
    setLoading(false);
  }

  function isImageOnSupabase(imageURL) {
    if (typeof imageURL != "string") {
      return false;
    } else {
      return imageURL.startsWith(supabaseUrl);
    }
  }

  function getPromptFromPredictions(predictions) {
    if (predictions.length == 0) {
      return "";
    }
    return predictions[0].input.prompt;
  }

  function getImageFromPredictions(predictions) {
    if (predictions.length == 0) {
      return "";
    }
    return predictions[0].control_image;
  }

  function getModelsFromPredictions(predictions) {
    return predictions.map((p) => p.model);
  }

  function predictionsStillRunning(predictions) {
    return predictions.some((p) => p.status != "succeeded");
  }

  const updateCheckedModels = (modelNames) => {
    // Create a new array where each model's `checked` value is updated
    const updatedModels = MODELS.map((model) => {
      // If the model's name is in the list of names, set `checked` to true, else set it to false
      return {
        ...model,
        checked: modelNames.includes(model.name),
      };
    });

    // Update the state with the new array
    setModels(updatedModels);
  };

  function getSelectedModels() {
    return models.filter((m) => m.checked);
  }

  function getPredictionsByVersion(version) {
    return predictions.filter((p) => p.version === version);
  }

  const handleCheckboxChange = (e) => {
    const modelId = parseInt(e.target.value, 10);

    // Update the checked flag for the model with the matching modelId
    const updatedModels = models.map((model) => {
      if (model.id === modelId) {
        return {
          ...model,
          checked: e.target.checked,
        };
      }
      return model;
    });

    // Set the new models array
    setModels(updatedModels);

    // save to local storage
    localStorage.setItem("models", JSON.stringify(updatedModels));
  };

  const handleImageChange = (file) => {
    console.log(file);
    setImageFile(file);
    setImageURL(URL.createObjectURL(file));
  };

  // cmd + enter to submit
  const onKeyDown = (e) => {
    if (e.metaKey && e.which === 13) {
      handleSubmit(e, prompt);
    }
  };

  function ogParams() {
    return new URLSearchParams({
      done: !predictionsStillRunning(predictions),
      prompt: getPromptFromPredictions(submissionPredictions),
      ids: submissionPredictions.map((prediction) => prediction.id).join(","),
    });
  }

  async function postPrediction(prompt, image, model, submissionId) {
    return fetch("/api/predictions/controlnet", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: prompt,
        image: image,
        version: model.version,
        source: model.source,
        model: model.name,
        anon_id: anonId,
        submission_id: submissionId,
      }),
    });
  }

  async function createReplicatePrediction(prompt, image, model, submissionId) {
    const response = await postPrediction(prompt, image, model, submissionId);
    let prediction = await response.json();

    if (response.status !== 201) {
      throw new Error(prediction.detail);
    }

    while (
      prediction.status !== "succeeded" &&
      prediction.status !== "failed"
    ) {
      await sleep(500);
      const response = await fetch("/api/predictions/" + prediction.id);
      prediction = await response.json();
      console.log(prediction);
      if (response.status !== 200) {
        throw new Error(prediction.detail);
      }
    }

    prediction.model = model.name;
    prediction.source = model.source;

    return prediction;
  }

  const handleSubmit = async (e, prompt, image) => {
    e.preventDefault();
    setError(null);
    setFirstTime(false);

    localStorage.setItem("hasRunControlnet", true);

    // update num runs and save to local storage
    const newNumRuns = Number(numRuns) + 1;
    setNumRuns(newNumRuns);
    localStorage.setItem("numRuns", newNumRuns);

    if (newNumRuns != 0 && newNumRuns % 10 == 0) {
      setPopupOpen(true);
    }

    let newImageURL;

    if (!isImageOnSupabase(imageURL)) {
      const imageName = `${uuidv4()}-${imageFile.name}`;

      // upload controlnet image
      const { data, error } = await supabase.storage
        .from("images")
        .upload(`public/${imageName}`, imageFile);

      if (data) {
        console.log(
          `successfully uploaded ${JSON.stringify(data)}, ${imageFile.name}`
        );
      } else {
        console.log(
          `failed uploaded ${JSON.stringify(error)}, ${imageFile.name}`
        );
        window.alert("Failed to upload image");
        return;
      }

      newImageURL = `${supabaseUrl}/storage/v1/object/public/images/public/${imageName}`;
      setImageURL(newImageURL);
    } else {
      newImageURL = imageURL;
    }

    console.log(`great, setting url to ${newImageURL}`);

    const submissionId = `${slugify(prompt, { lower: true })}-${(
      Math.random() + 1
    )
      .toString(36)
      .substring(5)}`;

    for (const model of getSelectedModels()) {
      // Use the model variable to generate predictions with the selected model
      for (let i = 0; i < numOutputs; i++) {
        let promise = null;

        promise = createReplicatePrediction(
          prompt,
          newImageURL,
          model,
          submissionId
        );
        promise.model = model.name;
        promise.source = model.source;
        promise.version = model.version;

        setPredictions((prev) => [...prev, promise]);

        promise
          .then((result) => {
            setPredictions((prev) =>
              prev.map((x) => (x === promise ? result : x))
            );
          })
          .catch((error) => setError(error.message));
      }
    }

    // push router to new page
    router.query.id = submissionId;
    router.push(router);
  };

  useEffect(() => {
    console.log(
      submissionPredictions.map((prediction) => prediction.id).join(",")
    );
    const anonId = localStorage.getItem("anonId");
    setLoading(true);

    // if the page has an id set
    if (id) {
      setPredictions(submissionPredictions);

      // get the model names from the predictions, and update which ones are checked
      const modelNames = getModelsFromPredictions(submissionPredictions);
      updateCheckedModels(modelNames);

      // get the prompt from the predictions, and update the prompt
      const submissionPrompt = getPromptFromPredictions(submissionPredictions);
      const submissionImage = getImageFromPredictions(submissionPredictions);

      console.log(`submission image is ${submissionImage}`);
      setPrompt(submissionPrompt);
      setImageURL(submissionImage);

      setLoading(false);
    } else {
      // load random seed
      if (router.isReady) {
        const seed = seeds[Math.floor(Math.random() * seeds.length)];

        getPredictionsFromSeed(seed);
        router.query.id = seed;
        router.push(router);
      }
    }

    // get number of runs from local storage
    const storedNumRuns = localStorage.getItem("numRuns");
    if (storedNumRuns) {
      setNumRuns(storedNumRuns);
    } else {
      localStorage.setItem("numRuns", numRuns);
    }

    const hasRunControlnet = localStorage.getItem("hasRunControlnet");
    if (hasRunControlnet) {
      setFirstTime(false);
    } else {
      setFirstTime(true);
    }

    // setup id
    if (!anonId) {
      const uuid = uuidv4();
      localStorage.setItem("anonId", uuid);
      setAnonId(uuid);
    } else {
      console.log("returning user: ", anonId);
      setAnonId(anonId);
    }
  }, []);

  console.log("predictions: ", predictions);

  return (
    <div className="mx-auto container p-5">
      <ZooHead
        ogDescription={
          submissionPredictions && submissionPredictions.length > 0
            ? getPromptFromPredictions(submissionPredictions)
            : "Compare text-to-image models like Stable Diffusion and DALL-E"
        }
        ogImage={`${baseUrl}/api/og?${ogParams()}`}
      />

      <Popup open={false} setOpen={setPopupOpen} />

      <Pills />

      <div className="pt-4">
        <div className="mx-0 max-w-7xl">
          <div className="flex justify-between mx-0">
            <div>
              {firstTime && (
                <div>
                  <Link
                    href="https://www.youtube.com/watch?v=GVCZHCLWON8"
                    className="text-2xl font-medium tracking-tight hover:underline text-gray-500"
                  >
                    ControlNet models take an input image and a text prompt and
                    generates a new image combining the two.
                  </Link>
                </div>
              )}
              <span className="text-2xl font-medium tracking-tight text-gray-900">
                What do you want to see?
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="md:grid grid-cols-12 gap-x-16 mt-2">
        {/* Form + Outputs */}

        <div className="col-span-10 h-full">
          <div className="">
            <form
              onKeyDown={onKeyDown}
              className="w-full"
              onSubmit={(e) => handleSubmit(e, prompt, imageFile)}
            >
              <div className="flex relative mt-2">
                <div className="w-full h-full relative">
                  <textarea
                    name="prompt"
                    className="w-full h-full border-2 -mb-1 p-3 pr-12 text-sm md:text-base rounded-md ring-brand outline-brand"
                    rows="1"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Enter a prompt to display an image"
                  />

                  <button
                    className="absolute right-3.5 top-2 mb-1 text-gray-500 hover:text-gray-900 px-1 py-2 rounded-md flex justify-center items-center"
                    type="button"
                    onClick={() => setPrompt(promptmaker({ flavors: null }))}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.5}
                      stroke="currentColor"
                      className="w-5 h-5"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
                      />
                    </svg>
                  </button>
                </div>

                <div className="ml-3 inline-flex">
                  <button
                    className="button bg-brand h-full flex justify-center items-center font-bold hover:bg-orange-600"
                    type="submit"
                  >
                    Go{" "}
                  </button>
                </div>
              </div>
            </form>
          </div>

          {loading && "Loading..."}

          <div className="mt-6">
            {!loading && getSelectedModels().length == 0 && <EmptyState />}

            {/* Controlnet image */}
            <div className="flex gap-6 tracking-wide mb-10">
              <div className="w-72 border-l-4 border-gray-900 pl-5 md:pl-6 py-2">
                <h5 className="text-xs md:text-sm text-gray-500 hover:text-gray-900">
                  Controlnet
                </h5>
                <Link href={imageURL} target="_blank" rel="noopener noreferrer">
                  <h5 className="text-base md:text-xl font-medium text-gray-800 hover:text-gray-500">
                    Original
                  </h5>
                </Link>
              </div>
              <div className="flex w-full overflow-y-hidden overflow-x-auto space-x-6">
                {imageURL ? (
                  <div className="relative mt-2">
                    <div className="image-wrapper rounded-xl">
                      <img
                        alt="Controlnet image"
                        src={imageURL}
                        className={`h-44 w-44 sm:h-52 sm:w-52 group relative rounded-xl aspect-square prediction-image`}
                      />
                    </div>
                    <button className="absolute h-12 w-12 text-gray-900 bg-white hover:text-gray-500 rounded-full -top-3 z-10 -right-3">
                      <XCircleIcon onClick={() => setImageURL("")} />
                    </button>
                  </div>
                ) : (
                  <FileUploader
                    handleChange={handleImageChange}
                    name="file"
                    label="Upload or drop a controlnet image here"
                    types={fileTypes}
                    required={true}
                    multiple={false}
                    hoverTitle="Drop here"
                  >
                    <div className="mt-2 flex justify-center rounded-lg border border-dashed border-gray-900/25 px-6 py-10">
                      <div className="text-center">
                        <PhotoIcon
                          className="mx-auto h-12 w-12 text-gray-300"
                          aria-hidden="true"
                        />
                        <div className="mt-4 flex text-sm leading-6 text-gray-600">
                          <label
                            htmlFor="file-upload"
                            className="relative cursor-pointer rounded-md bg-white font-semibold text-black focus-within:outline-none focus-within:ring-2 focus-within:ring-indigo-600 focus-within:ring-offset-2 hover:text-gray-700"
                          >
                            <span>Upload a file</span>
                            <input
                              id="file-upload"
                              name="file-upload"
                              type="file"
                              className="sr-only"
                            />
                          </label>
                          <p className="pl-1">or drag and drop</p>
                        </div>
                        <p className="text-xs leading-5 text-gray-600">
                          PNG, JPG
                        </p>
                      </div>
                    </div>
                  </FileUploader>
                )}

                {firstTime && (
                  <div className="w-32 mt-2 rotate-6 text-gray-600 ">
                    <div className="flex items-center ">
                      <span>&larr;</span>
                      <p className="text-xs animate-pulse font-medium pl-2">
                        Click to upload your own image
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {getSelectedModels().map((model) => (
              <div key={model.id} className="mt-5">
                <div className="flex gap-6 tracking-wide mb-10">
                  {/* Model description */}
                  <div className="w-72 border-l-4 border-gray-900 pl-5 md:pl-6 py-2">
                    <h5 className="text-xs md:text-sm text-gray-500 hover:text-gray-900">
                      Controlnet
                    </h5>
                    <Link
                      href={model.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <h5 className="text-base md:text-xl font-medium text-gray-800 hover:text-gray-500">
                        {model.name}
                      </h5>
                    </Link>
                    <p className="text-xs md:text-sm text-gray-500 mt-2 md:mt-4">
                      {model.description}
                    </p>

                    <div className="mt-2 md:mt-6 flex gap-2">
                      {model.links != null &&
                        model.links.map((link) => (
                          <ExternalLink
                            key={`${model.id}-${link.url}`}
                            link={link}
                          />
                        ))}
                    </div>
                  </div>

                  {/* Row for predictions */}
                  <div className="flex w-full overflow-y-hidden overflow-x-auto space-x-6">
                    {getPredictionsByVersion(model.version)
                      .reverse()
                      .map((prediction) => (
                        <>
                          <ControlnetPrediction
                            key={prediction.id}
                            prediction={prediction}
                            height={"52"}
                            width={"52"}
                          />
                        </>
                      ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <Checkboxes
          models={models}
          handleCheckboxChange={handleCheckboxChange}
          className={"mt-28"}
        />
      </div>
    </div>
  );
}

const Checkboxes = ({ models, handleCheckboxChange, className }) => {
  return (
    <div className={`col-span-2 mb-28 ${className}`}>
      <div>
        <h5 className="text-lg text-gray-800 font-bold">Models</h5>
        <div className="mt-4 grid space-y-1">
          {models.map((model) => (
            <div key={model.id} className="relative flex items-center">
              <div className="flex h-7 items-center">
                <input
                  className="h-4 w-4 rounded accent-brand border-gray-300 focus:ring-indigo-600"
                  type="checkbox"
                  id={`model_input_${model.id}`}
                  value={model.id}
                  checked={model.checked}
                  onChange={handleCheckboxChange}
                />
              </div>
              <div className="ml-3 text-xs md:text-sm leading-6">
                <label
                  htmlFor={`model_input_${model.id}`}
                  className={model.checked ? "text-gray-900" : "text-gray-500"}
                >
                  {model.name}
                </label>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className=" text-xs text-gray-500 mt-4">
        <label>
          Each ControlNet model runs a different pre-processor on your input
          image.{" "}
          <Link
            href="https://www.youtube.com/watch?v=GVCZHCLWON8"
            className="font-bold hover:underline text-black"
          >
            Learn More &rarr;
          </Link>
        </label>
      </div>
    </div>
  );
};

export function EmptyState() {
  return (
    <div className="text-center mt-16">
      <img
        alt="confused robot"
        className="mx-auto rounded-lg"
        src="./confused_bot.png"
      />
      <h3 className="mt-12 text-sm font-semibold text-gray-900">
        No model selected!
      </h3>
      <p className="mt-1 text-sm text-gray-500">Select a model on the right.</p>
    </div>
  );
}
export function EmptyStateHistory() {
  return (
    <div className="text-center mt-16">
      <img
        alt="confused robot"
        className="mx-auto rounded-lg"
        src="./confused_bot.png"
      />
      <h3 className="mt-12 text-sm font-semibold text-gray-900">
        No memories yet!
      </h3>
      <p className="mt-1 text-sm text-gray-500">Create some images first.</p>
    </div>
  );
}

// Use getServerSideProps to force Next.js to render the page on the server,
// so the OpenGraph meta tags will have the proper URL at render time.
export async function getServerSideProps({ req }) {
  // Hack to get the protocol and host from headers:
  // https://github.com/vercel/next.js/discussions/44527
  const protocol = req.headers.referer?.split("://")[0] || "http";
  const submissionId = req.url.split("?id=")[1];
  const baseUrl = `${protocol}://${req.headers.host}`;

  let submissionPredictions = [];

  if (submissionId) {
    const response = await fetch(`${baseUrl}/api/submissions/${submissionId}`, {
      method: "GET",
    });
    submissionPredictions = await response.json();
  }
  return { props: { baseUrl, submissionPredictions } };
}
