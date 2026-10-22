# 模型
| 文件 | 来源 | 许可证 | 用于 |
|---|---|---|---|
| `hivision_modnet.onnx` | [HivisionIDPhotos release `pretrained-model`](https://github.com/Zeyi-Lin/HivisionIDPhotos/releases/tag/pretrained-model) | Apache-2.0（随项目发布） | 证件照人像抠图（MODNet，输入 1×3×512×512） |
| `blaze_face_short_range.tflite` | [MediaPipe Face Detector](https://ai.google.dev/edge/mediapipe/solutions/vision/face_detector) | Apache-2.0 | 人脸检测 |
| `isnet_general_int8w.onnx` | [rembg release `v0.0.0`](https://github.com/danielgatis/rembg/releases/tag/v0.0.0) 的 `isnet-general-use.onnx`（[DIS / IS-Net](https://github.com/xuebinqin/DIS)），用 `days/day03-cutout/make_model.py` 转换：只留主输出、卷积权重量化成 int8（推理仍是 fp32）、Resize 改成按倍数（支持 768 等输入） | Apache-2.0（DIS）；rembg 本身 MIT | 通用抠图（输入 1×3×H×W，边长 64 的倍数，原版 1024） |
